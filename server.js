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
    "amlodipine": "Amlodipine", "amlowas": "Amlodipine", "stamlo": "Amlodipine", "norvasc": "Amlodipine",
    "telmisartan": "Telmisartan", "telma": "Telmisartan", "telvas": "Telmisartan",
    "atorvastatin": "Atorvastatin", "atorva": "Atorvastatin", "lipvas": "Atorvastatin",
    "warfarin": "Warfarin", "coumadin": "Warfarin",
    "aspirin": "Aspirin", "ecosprin": "Aspirin", "disprin": "Aspirin",
    "pantoprazole": "Pantoprazole", "pantocid": "Pantoprazole", "pan": "Pantoprazole", 
    "omez": "Pantoprazole", "omeprazole": "Omeprazole",
    "acorus calamus": "Acorus calamus", "vacha": "Acorus calamus",
    "aesculus indica": "Aesculus indica", "indian horse chestnut": "Aesculus indica",
    "allium sativum": "Allium sativum", "garlic": "Allium sativum",
    "andrographis paniculata": "Andrographis paniculata", "kalmegh": "Andrographis paniculata",
    "berberis aristata": "Berberis aristata", "daruharidra": "Berberis aristata",
    "carum carvi": "Carum carvi", "krishna jeeraka": "Carum carvi",
    "centella asiatica": "Centella asiatica", "mandukaparni": "Centella asiatica",
    "commiphora wightii": "Commiphora wightii", "guggulu": "Commiphora wightii",
    "curcuma longa": "Curcuma longa", "haridra": "Curcuma longa", "turmeric": "Curcuma longa", "haldi": "Curcuma longa",
    "curcumin": "Curcumin", "curcuminoids": "Curcumin",
    "glycyrrhiza glabra": "Glycyrrhiza glabra", "yashtimadhu": "Glycyrrhiza glabra", "mulethi": "Glycyrrhiza glabra",
    "myristica fragrans": "Myristica fragrans", "jatiphala": "Myristica fragrans",
    "narthex asafetida": "Narthex asafetida", "hing": "Narthex asafetida",
    "phyllanthus amarus": "Phyllanthus amarus", "bhumyamalaki": "Phyllanthus amarus",
    "salacia reticulata": "Salacia reticulata", "saptarangi": "Salacia reticulata",
    "terminalia arjuna": "Terminalia arjuna", "arjuna": "Terminalia arjuna",
    "terminalia chebula": "Terminalia chebula", "haritaki": "Terminalia chebula",
    "brahmi": "Brahmi", "bacopa monnieri": "Brahmi",
    "triphala": "Triphala", "amla": "Triphala", "triphala churna": "Triphala",
    "gallic acid": "Gallic Acid", "ashwagandha": "Ashwagandha", "withania": "Ashwagandha"
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
        if (data.error && data.error.includes("currently loading")) return { status: "AI Model Initializing" };
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
        if (!fs.existsSync(CSV_PATH)) {
            console.error("❌ CSV NOT FOUND");
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
            .on('end', () => {
                console.log(`✅ CSV Loaded: ${interactionsDB.length} records.`);
                resolve();
            });
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
    let finalResults = [];

    // --- LOGIC 1: BIOBERT SCAN (Always run first) ---
    const aiResponse = await queryBioBERT(text);
    if (aiResponse) {
        finalResults.push({ 
            source: "BioBERT AI Analysis", 
            clinical_effect: "AI detected interaction markers in clinical text.",
            data: aiResponse 
        });
    }

    // --- LOGIC 2: SYNONYM BRIDGE (The "Enhancer") ---
    let detected = [];
    Object.keys(SYNONYM_BRIDGE).forEach(key => {
        if (new RegExp(`\\b${key}\\b`, 'gi').test(input)) {
            detected.push(SYNONYM_BRIDGE[key]);
        }
    });

    let entities = [...new Set(detected)];

    // --- LOGIC 3: PUBMED (Literature Search) ---
    // If bridge found entities, use them. Otherwise, attempt to extract nouns from text.
    let searchH, searchD;
    if (entities.length >= 2) {
        searchH = entities[0];
        searchD = entities[1];
    } else {
        const words = text.split(/\s+/).filter(w => w.length > 4);
        searchH = words[0] || "Unknown";
        searchD = words[1] || "Unknown";
    }

    if (searchH !== "Unknown" && searchD !== "Unknown") {
        const pCount = await fetchPubMed(searchH, searchD);
        finalResults.push({ 
            source: "PubMed Literature", 
            clinical_effect: pCount > 0 
                ? `Found ${pCount} clinical papers for ${searchH} & ${searchD}.` 
                : `No direct clinical evidence for ${searchH} & ${searchD} found in PubMed.` 
        });
    }

    // --- LOGIC 4: MASTER CSV MATCH ---
    if (entities.length >= 2) {
        const matches = interactionsDB.filter(i => 
            (i.herb === entities[0].toLowerCase() && i.drug.includes(entities[1].toLowerCase())) ||
            (i.herb === entities[1].toLowerCase() && i.drug.includes(entities[0].toLowerCase()))
        );
        finalResults.push(...matches);
    }

    res.json({ 
        results: finalResults, 
        entities: entities.length > 0 ? entities : [searchH, searchD] 
    });
});

// --- 6. START ---
const PORT = process.env.PORT || 10000;
loadCSV().then(() => {
    app.listen(PORT, '0.0.0.0', () => console.log(`🚀 CDSS Online` ));
});
