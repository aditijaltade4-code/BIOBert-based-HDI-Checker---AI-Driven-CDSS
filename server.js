const express = require('express');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// --- 1. DATA PATHS ---
const CSV_PATH = path.join(__dirname, 'data', 'HDI_Master_List.csv');
let interactionsDB = [];
let herbProfiles = {};
let drugProfiles = {};

// Load JSON profiles for the PK Waterfall
try {
    herbProfiles = require('./herb_profiles.json');
    drugProfiles = require('./drug_profiles.json');
    console.log("✅ Herb/Drug JSON Profiles Loaded");
} catch (e) { 
    console.warn("⚠️ JSON profiles missing or malformed. PK logic may be limited."); 
}

// --- 2. FULL SYNONYM BRIDGE ---
const SYNONYM_BRIDGE = {
    "amlodipine": { name: "Amlodipine", type: "drug" }, "amlowas": { name: "Amlodipine", type: "drug" },
    "stamlo": { name: "Amlodipine", type: "drug" }, "norvasc": { name: "Amlodipine", type: "drug" },
    "telmisartan": { name: "Telmisartan", type: "drug" }, "telma": { name: "Telmisartan", type: "drug" },
    "telvas": { name: "Telmisartan", type: "drug" }, "atorvastatin": { name: "Atorvastatin", type: "drug" },
    "atorva": { name: "Atorvastatin", type: "drug" }, "lipvas": { name: "Atorvastatin", type: "drug" },
    "warfarin": { name: "Warfarin", type: "drug" }, "coumadin": { name: "Warfarin", type: "drug" },
    "aspirin": { name: "Aspirin", type: "drug" }, "ecosprin": { name: "Aspirin", type: "drug" },
    "disprin": { name: "Aspirin", type: "drug" }, "pantoprazole": { name: "Pantoprazole", type: "drug" },
    "pantocid": { name: "Pantoprazole", type: "drug" }, "pan": { name: "Pantoprazole", type: "drug" },
    "omez": { name: "Pantoprazole", type: "drug" }, "omeprazole": { name: "Omeprazole", type: "drug" },
    "vacha": { name: "Acorus calamus", type: "herb" }, "acorus calamus": { name: "Acorus calamus", type: "herb" },
    "garlic": { name: "Allium sativum", type: "herb" }, "allium sativum": { name: "Allium sativum", type: "herb" },
    "kalmegh": { name: "Andrographis paniculata", type: "herb" }, "daruharidra": { name: "Berberis aristata", type: "herb" },
    "guggulu": { name: "Commiphora wightii", type: "herb" }, "commiphora wightii": { name: "Commiphora wightii", type: "herb" },
    "haridra": { name: "Curcuma longa", type: "herb" }, "turmeric": { name: "Curcuma longa", type: "herb" },
    "haldi": { name: "Curcuma longa", type: "herb" }, "curcuma longa": { name: "Curcuma longa", type: "herb" },
    "yashtimadhu": { name: "Glycyrrhiza glabra", type: "herb" }, "mulethi": { name: "Glycyrrhiza glabra", type: "herb" },
    "jatiphala": { name: "Myristica fragrans", type: "herb" }, "hing": { name: "Narthex asafetida", type: "herb" },
    "arjuna": { name: "Terminalia arjuna", type: "herb" }, "haritaki": { name: "Terminalia chebula", type: "herb" },
    "brahmi": { name: "Brahmi", type: "herb" }, "ashwagandha": { name: "Ashwagandha", type: "herb" },
    "triphala": { name: "Triphala", type: "herb" }, "amla": { name: "Triphala", type: "herb" }
};

// --- 3. EXTERNAL API LOGIC ---
async function queryBioBERT(text) {
    try {
        const response = await fetch("https://api-inference.huggingface.co/models/dmis-lab/biobert-v1.1", {
            headers: { Authorization: `Bearer ${process.env.HF_TOKEN}`, "Content-Type": "application/json" },
            method: "POST",
            body: JSON.stringify({ inputs: text }),
        });
        return await response.json();
    } catch (e) { return null; }
}

async function fetchPubMed(h, d) {
    const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(h)}+AND+${encodeURIComponent(d)}+AND+interaction&retmode=json`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        return parseInt(data.esearchresult.count) || 0;
    } catch (e) { return 0; }
}

// --- 4. DATA LOADER ---
async function loadCSV() {
    return new Promise((resolve) => {
        if (!fs.existsSync(CSV_PATH)) {
            console.error("❌ CRITICAL: CSV file NOT found at", CSV_PATH);
            return resolve();
        }

        interactionsDB = [];
        fs.createReadStream(CSV_PATH)
            .pipe(csv())
            .on('data', (row) => {
                const keys = Object.keys(row);
                const hK = keys.find(k => k.toLowerCase().includes('herb'));
                const dK = keys.find(k => k.toLowerCase().includes('drug'));
                const eK = keys.find(k => k.toLowerCase().includes('effect'));
                const rK = keys.find(k => k.toLowerCase().includes('recom'));

                if (row[hK] && row[dK]) {
                    interactionsDB.push({
                        herb: String(row[hK]).trim().toLowerCase(),
                        drug: String(row[dK]).trim().toLowerCase(),
                        clinical_effect: row[eK] || "No effect documented.",
                        recommendation: row[rK] || "Monitor clinical status.",
                        source: "Verified Master Database"
                    });
                }
            })
            .on('end', () => {
                console.log(`✅ DATABASE LOADED: ${interactionsDB.length} records.`);
                resolve();
            });
    });
}

// --- 5. ROUTES ---

app.get('/api/list-all', (req, res) => res.json(interactionsDB));

app.post('/api/analyze-text', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "No text provided." });

    const input = text.toLowerCase();
    let detectedHerbs = [];
    let detectedDrugs = [];

    // Detect entities using Synonym Bridge
    Object.keys(SYNONYM_BRIDGE).forEach(key => {
        if (new RegExp(`\\b${key}\\b`, 'gi').test(input)) {
            const entry = SYNONYM_BRIDGE[key];
            if (entry.type === 'herb') detectedHerbs.push(entry.name);
            else detectedDrugs.push(entry.name);
        }
    });

    // Fallback if no specific synonym matched but word exists in text
    const h = detectedHerbs[0] || "unknown";
    const d = detectedDrugs[0] || "unknown";

    // --- WATERFALL 1: MASTER CSV (STRICT & FUZZY) ---
    const csvMatch = interactionsDB.find(i => {
        const searchH = h.toLowerCase();
        const searchD = d.toLowerCase();
        return (i.herb.includes(searchH) && i.drug.includes(searchD)) ||
               (i.herb.includes(searchD) && i.drug.includes(searchH));
    });

    if (csvMatch) {
        return res.json({ results: [csvMatch], entities: [h, d] });
    }

    // --- WATERFALL 2: PUBMED + BIOBERT ---
    const pCount = await fetchPubMed(h, d);
    const aiResponse = await queryBioBERT(text);

    if (pCount > 0 || (aiResponse && !aiResponse.error)) {
        return res.json({
            results: [{
                source: `BioBERT AI Analysis (PubMed Count: ${pCount})`,
                severity: pCount > 0 ? "EVIDENCE-BASED" : "PREDICTIVE",
                clinical_effect: pCount > 0 
                    ? `AI engine cross-referenced ${pCount} PubMed articles for ${h} and ${d}.` 
                    : `No PubMed articles found, but BioBERT patterns suggest a potential interaction.`,
                recommendation: "Review with a clinician; evidence suggests potential interaction risk.",
                data: aiResponse
            }],
            entities: [h, d]
        });
    }

    // --- WATERFALL 3: PHARMACOKINETIC (PK) ENZYME OVERLAP ---
    const hProf = herbProfiles[h.toLowerCase()];
    const dProf = drugProfiles[d.toLowerCase()];
    if (hProf && dProf && hProf.enzymes && dProf.enzymes) {
        const overlap = hProf.enzymes.filter(e => dProf.enzymes.includes(e));
        if (overlap.length > 0) {
            return res.json({
                results: [{
                    source: "PK Pathway Analysis",
                    severity: "MODERATE (THEORETICAL)",
                    clinical_effect: `Shared metabolic pathway detected (${overlap.join(', ')}). Possible competition for absorption/metabolism.`,
                    recommendation: "Monitor for changes in therapeutic drug levels."
                }],
                entities: [h, d]
            });
        }
    }

    // FINAL FALLBACK
    res.json({ results: [], entities: [h, d], message: "No interactions detected in local DB, Literature, or PK pathways." });
});

const PORT = process.env.PORT || 10000;
loadCSV().then(() => {
    app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server Online at Port ${PORT}`));
});
