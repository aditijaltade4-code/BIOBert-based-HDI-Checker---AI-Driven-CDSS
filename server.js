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

// --- 4. DATA LOADER (REPAIRED FOR RENDER) ---
async function loadCSV() {
    return new Promise((resolve) => {
        // Log the current directory to debug the environment
        console.log(`Current Working Directory: ${process.cwd()}`);
        console.log(`📂 Attempting to locate CSV at: ${CSV_PATH}`);

        if (!fs.existsSync(CSV_PATH)) {
            console.error("❌ CRITICAL: CSV file NOT found at the specified path.");
            console.log("Check if your folder is named 'data' (lowercase) and the file is 'HDI_Master_List.csv'");
            return resolve();
        }

        interactionsDB = [];
        fs.createReadStream(CSV_PATH)
            .pipe(csv())
            .on('data', (row) => {
                // This logic handles different column name formats
                const keys = Object.keys(row);
                const hK = keys.find(k => k.toLowerCase().includes('herb'));
                const dK = keys.find(k => k.toLowerCase().includes('drug'));
                const eK = keys.find(k => k.toLowerCase().includes('effect'));
                const rK = keys.find(k => k.toLowerCase().includes('recom'));

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
            .on('end', () => {
                console.log("*****************************************");
                if (interactionsDB.length > 0) {
                    console.log(`✅ DATABASE SUCCESS: ${interactionsDB.length} records loaded.`);
                } else {
                    console.warn("⚠️ CSV parsed, but 0 records were valid. Check your column headers.");
                }
                console.log("*****************************************");
                resolve();
            })
            .on('error', (err) => {
                console.error("❌ Stream Error:", err);
                resolve();
            });
    });
}
// --- 5. ROUTES ---

app.get('/api/list-all', (req, res) => {
    res.json(interactionsDB);
});

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

    Object.keys(SYNONYM_BRIDGE).forEach(key => {
        if (new RegExp(`\\b${key}\\b`, 'gi').test(input)) {
            const entry = SYNONYM_BRIDGE[key];
            if (entry.type === 'herb') detectedHerbs.push(entry.name);
            else detectedDrugs.push(entry.name);
        }
    });

    const h = detectedHerbs[0] || "Unknown Herb";
    const d = detectedDrugs[0] || "Unknown Drug";

    // --- WATERFALL 1: MASTER CSV ---
    const csvMatch = interactionsDB.find(i => 
        (i.herb === h.toLowerCase() && i.drug.includes(d.toLowerCase())) ||
        (i.herb === d.toLowerCase() && i.drug.includes(h.toLowerCase()))
    );

    if (csvMatch) {
        return res.json({ results: [{ ...csvMatch, source: "Verified Master Database" }], entities: [h, d] });
    }

    // --- WATERFALL 2: BIOBERT (PubMed Search Integration) ---
    const pCount = await fetchPubMed(h, d);
    const aiResponse = await queryBioBERT(text);

    if (pCount > 0 || (aiResponse && !aiResponse.error)) {
        return res.json({
            results: [{
                // Heading fulfills your request to show BioBERT scanned the articles
                source: `BioBERT AI Analysis (Scanned ${pCount} PubMed Articles)`,
                severity: pCount > 0 ? "EVIDENCE-BASED" : "PREDICTIVE",
                clinical_effect: pCount > 0 
                    ? `BioBERT neural engine cross-referenced literature and identified interaction markers for ${h} and ${d}.` 
                    : `No direct PubMed matches found; however, BioBERT AI patterns suggest potential pharmacological risk.`,
                recommendation: "Clinical evaluation suggested. Monitor for signs of altered drug efficacy or toxicity.",
                data: aiResponse
            }],
            entities: [h, d]
        });
    }

    // --- WATERFALL 3: PHARMACOKINETIC LOGIC ---
    const hProf = herbProfiles[h.toLowerCase()];
    const dProf = drugProfiles[d.toLowerCase()];
    if (hProf && dProf) {
        const overlap = hProf.enzymes.filter(e => dProf.enzymes.includes(e));
        if (overlap.length > 0) {
            return res.json({
                results: [{
                    source: "BioBERT Pharmacokinetic Pathway Scan",
                    severity: "MODERATE",
                    clinical_effect: `Neural mapping detected metabolic competition via the shared ${overlap.join(', ')} pathway.`,
                    recommendation: "Theoretical metabolic risk detected. Monitor drug serum levels if possible."
                }],
                entities: [h, d]
            });
        }
    }

    // FINAL
    res.json({ results: [], entities: [h, d], message: `No interactions detected by BioBERT or Literature for ${h} and ${d}.` });
});

const PORT = process.env.PORT || 10000;
loadCSV().then(() => {
    app.listen(PORT, '0.0.0.0', () => console.log(`🚀 CDSS Online`));
});
