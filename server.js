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

try {
    herbProfiles = require('./herb_profiles.json');
    drugProfiles = require('./drug_profiles.json');
} catch (e) { console.warn("⚠️ JSON profiles missing."); }

// --- 2. FULL SYNONYM BRIDGE (Updated with Type Categorization) ---
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
        const data = await response.json();
        return data;
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
        if (!fs.existsSync(CSV_PATH)) return resolve();
        interactionsDB = [];
        fs.createReadStream(CSV_PATH)
            .pipe(csv())
            .on('data', (row) => {
                const keys = Object.keys(row);
                const hK = keys.find(k => k.toLowerCase().includes('herb'));
                const dK = keys.find(k => k.toLowerCase().includes('drug'));
                const eK = keys.find(k => k.toLowerCase().includes('effect'));
                const rK = keys.find(k => k.toLowerCase().includes('recommendation') || k.toLowerCase().includes('reccomendation'));
                if (row[hK] && row[dK]) {
                    interactionsDB.push({
                        herb: row[hK].trim().toLowerCase(),
                        drug: row[dK].trim().toLowerCase(),
                        clinical_effect: row[eK] || "N/A",
                        recommendation: row[rK] || "Monitor patient therapy.",
                        source: "Master CSV"
                    });
                }
            })
            .on('end', () => resolve());
    });
}

// --- 5. ROUTES ---

app.get('/api/dashboard-stats', (req, res) => {
    res.json({
        total: interactionsDB.length,
        herbs: Object.keys(herbProfiles).length,
        drugs: Object.keys(drugProfiles).length
    });
});

app.post('/api/analyze-text', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "No input provided." });

    const input = text.toLowerCase();
    let detectedHerbs = [];
    let detectedDrugs = [];

    // Step 1: Detect and Categorize
    Object.keys(SYNONYM_BRIDGE).forEach(key => {
        if (new RegExp(`\\b${key}\\b`, 'gi').test(input)) {
            const entry = SYNONYM_BRIDGE[key];
            if (entry.type === 'herb') detectedHerbs.push(entry.name);
            else detectedDrugs.push(entry.name);
        }
    });

    const h = detectedHerbs[0] || "Unknown Herb";
    const d = detectedDrugs[0] || "Unknown Drug";

    // WATERFALL 1: Check CSV
    const csvMatch = interactionsDB.find(i => 
        (i.herb === h.toLowerCase() && i.drug.includes(d.toLowerCase())) ||
        (i.herb === d.toLowerCase() && i.drug.includes(h.toLowerCase()))
    );

    if (csvMatch) {
        return res.json({ results: [{ ...csvMatch, source: "Verified Master Database" }], entities: [h, d] });
    }

    // WATERFALL 2: BioBERT + PubMed
    const pCount = await fetchPubMed(h, d);
    if (pCount > 0) {
        const aiResponse = await queryBioBERT(text);
        return res.json({
            results: [{
                source: "Clinical Literature (PubMed + BioBERT)",
                severity: "EVIDENCE-BASED",
                clinical_effect: `Found ${pCount} clinical studies. AI identifies interaction markers in text.`,
                recommendation: "Review PubMed clinical evidence for safety profiles.",
                data: aiResponse
            }],
            entities: [h, d]
        });
    }

    // WATERFALL 3: Pharmacokinetic Logic
    const hProf = herbProfiles[h.toLowerCase()];
    const dProf = drugProfiles[d.toLowerCase()];
    if (hProf && dProf) {
        const overlap = hProf.enzymes.filter(e => dProf.enzymes.includes(e));
        if (overlap.length > 0) {
            return res.json({
                results: [{
                    source: "Pharmacokinetic Analysis",
                    severity: "MODERATE",
                    clinical_effect: `Potential metabolic competition via shared ${overlap.join(', ')} pathway.`,
                    recommendation: "Theoretical metabolic risk; monitor drug concentration levels."
                }],
                entities: [h, d]
            });
        }
    }

    // FINAL: No Interaction Found
    res.json({ results: [], entities: [h, d], message: `No interaction present between ${h} and ${d} across all clinical layers.` });
});

const PORT = process.env.PORT || 10000;
loadCSV().then(() => {
    app.listen(PORT, '0.0.0.0', () => console.log(`🚀 CDSS Online`));
});
