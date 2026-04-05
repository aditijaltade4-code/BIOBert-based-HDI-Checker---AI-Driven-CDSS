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
    console.log("✅ Herb/Drug JSON Profiles Loaded");
} catch (e) { 
    console.warn("⚠️ JSON profiles missing or malformed."); 
}

// --- 2. THE COMPREHENSIVE SYNONYM BRIDGE ---
const SYNONYM_BRIDGE = {
    // --- DRUGS & BRANDS ---
    "metformin": { name: "Metformin", type: "drug" }, "glycomet": { name: "Metformin", type: "drug" },
    "amitriptyline": { name: "Amitriptyline", type: "drug" }, "elavil": { name: "Amitriptyline", type: "drug" },
    "amlodipine": { name: "Amlodipine", type: "drug" }, "norvasc": { name: "Amlodipine", type: "drug" },
    "atenolol": { name: "Atenolol", type: "drug" }, "tenormin": { name: "Atenolol", type: "drug" },
    "telmisartan": { name: "Telmisartan", type: "drug" }, "telma": { name: "Telmisartan", type: "drug" },
    "losartan": { name: "Losartan", type: "drug" }, "cozaar": { name: "Losartan", type: "drug" },
    "warfarin": { name: "Warfarin", type: "drug" }, "coumadin": { name: "Warfarin", type: "drug" },
    "aspirin": { name: "Aspirin", type: "drug" }, "ecosprin": { name: "Aspirin", type: "drug" },
    "clopidogrel": { name: "Clopidogrel", type: "drug" }, "clopilet": { name: "Clopidogrel", type: "drug" },
    "pantoprazole": { name: "Pantoprazole", type: "drug" }, "pantocid": { name: "Pantoprazole", type: "drug" },
    "omez": { name: "Pantoprazole", type: "drug" }, "omeprazole": { name: "Omeprazole", type: "drug" },
    "glimepiride": { name: "Glimepiride", type: "drug" }, "amaryl": { name: "Glimepiride", type: "drug" },
    "cisplatin": { name: "Cisplatin", type: "drug" }, "gentamicin": { name: "Gentamicin", type: "drug" },
    "midazolam": { name: "Midazolam", type: "drug" }, "versed": { name: "Midazolam", type: "drug" },

    // --- HERBS & SCIENTIFIC NAMES ---
    "triphala": { name: "Triphala", type: "herb" }, "terminalia chebula": { name: "Triphala", type: "herb" },
    "ashwagandha": { name: "Ashwagandha", type: "herb" }, "withania somnifera": { name: "Ashwagandha", type: "herb" },
    "gokshura": { name: "Gokshura", type: "herb" }, "tribulus terrestris": { name: "Gokshura", type: "herb" },
    "garlic": { name: "Garlic", type: "herb" }, "allium sativum": { name: "Garlic", type: "herb" }, "lahsun": { name: "Garlic", type: "herb" },
    "arjuna": { name: "Arjuna", type: "herb" }, "terminalia arjuna": { name: "Arjuna", type: "herb" },
    "baheda": { name: "Baheda", type: "herb" }, "terminalia bellirica": { name: "Baheda", type: "herb" }, "bibhitaki": { name: "Baheda", type: "herb" },
    "centella asiatica": { name: "Centella asiatica", type: "herb" }, "gotu kola": { name: "Centella asiatica", type: "herb" }, "mandukaparni": { name: "Centella asiatica", type: "herb" },
    "guduchi": { name: "Guduchi", type: "herb" }, "tinospora cordifolia": { name: "Guduchi", type: "herb" }, "giloy": { name: "Guduchi", type: "herb" },
    "guggul": { name: "Guggul", type: "herb" }, "commiphora wightii": { name: "Guggul", type: "herb" },
    "cinnamon": { name: "Cinnamon", type: "herb" }, "dalchini": { name: "Cinnamon", type: "herb" },
    "bitter melon": { name: "Bitter melon", type: "herb" }, "karela": { name: "Bitter melon", type: "herb" },
    "fenugreek": { name: "Fenugreek", type: "herb" }, "methi": { name: "Fenugreek", type: "herb" },
    "aloe vera": { name: "Aloe vera", type: "herb" }, "aloe barbadensis": { name: "Aloe vera", type: "herb" },
    "turmeric": { name: "Turmeric", type: "herb" }, "curcuma longa": { name: "Turmeric", type: "herb" }, "haldi": { name: "Turmeric", type: "herb" },
    "brahmi": { name: "Brahmi", type: "herb" }, "bacopa monnieri": { name: "Brahmi", type: "herb" },
    "ginger": { name: "Ginger", type: "herb" }, "zingiber officinale": { name: "Ginger", type: "herb" },
    "black pepper": { name: "Black pepper", type: "herb" }, "piper nigrum": { name: "Black pepper", type: "herb" }
};

// --- 3. EXTERNAL API LOGIC ---
async function queryBioBERT(text) {
    try {
        const response = await fetch("https://api-inference.huggingface.co/models/aditijaltade4/BIOBert-based-HDI-Checker", {
            headers: { 
                Authorization: `Bearer ${process.env.HF_TOKEN}`, 
                "Content-Type": "application/json" 
            },
            method: "POST",
            body: JSON.stringify({ 
                inputs: text,
                options: { wait_for_model: true }
            }),
        });
        const result = await response.json();
        return result;
    } catch (e) { 
        console.error("BioBERT Query Error:", e);
        return null; 
    }
}

async function fetchPubMed(h, d) {
    const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(h)}+AND+${encodeURIComponent(d)}+AND+interaction&retmode=json`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        return parseInt(data.esearchresult.count) || 0;
    } catch (e) { return 0; }
}

// --- 4. DATA LOADER (FIXED: NOW CAPTURES ALL COLUMNS) ---
async function loadCSV() {
    return new Promise((resolve) => {
        if (!fs.existsSync(CSV_PATH)) return resolve();
        interactionsDB = [];
        fs.createReadStream(CSV_PATH)
            .pipe(csv())
            .on('data', (row) => {
                // Mapping the dynamic columns from your HD Master File
                const entry = {
                    herb: (row['Herb'] || row['herb'] || "").toLowerCase().trim(),
                    drug: (row['Drug'] || row['drug'] || "").toLowerCase().trim(),
                    clinical_effect: row['Clinical Effect'] || row['Effect'] || "No effect documented.",
                    recommendation: row['Recommendation'] || row['Recom'] || "Monitor clinical status.",
                    severity: row['Severity'] || "Moderate",
                    // --- NEW: Capturing the technical data you requested ---
                    mechanism: row['Mechanism'] || row['Interaction Mechanism'] || "N/A",
                    interaction_type: row['Interaction Type'] || "N/A",
                    evidence: row['Evidence'] || "N/A",
                    pk_pd: row['Pharmacokinetics/Pharmacodynamics'] || row['PK/PD'] || "N/A",
                    source: "HD Master Database"
                };
                if (entry.herb && entry.drug) interactionsDB.push(entry);
            })
            .on('end', () => {
                console.log(`✅ DATABASE LOADED: ${interactionsDB.length} records with full technical data.`);
                resolve();
            });
    });
}
// --- 5. ROUTES ---
app.get('/api/list-all', (req, res) => res.json(interactionsDB));

app.post('/api/analyze-text', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "No input provided." });

    const input = text.toLowerCase();
    let detectedHerbs = [];
    let detectedDrugs = [];

    // Entity Detection
    Object.keys(SYNONYM_BRIDGE).forEach(key => {
        if (new RegExp(`\\b${key}\\b`, 'gi').test(input)) {
            const entry = SYNONYM_BRIDGE[key];
            if (entry.type === 'herb') detectedHerbs.push(entry.name);
            else detectedDrugs.push(entry.name);
        }
    });

    const h = detectedHerbs[0] || "unknown";
    const d = detectedDrugs[0] || "unknown";

    if (h === "unknown" && d === "unknown") {
        return res.json({ 
            results: [], 
            entities: [h, d], 
            message: "I could not identify a specific herb and drug interaction." 
        });
    }

    // Waterfall 1: Local Master CSV
    const csvMatch = interactionsDB.find(i => {
        const findH = h.toLowerCase();
        const findD = d.toLowerCase();
        return (i.herb.includes(findH) && i.drug.includes(findD)) ||
               (i.herb.includes(findD) && i.drug.includes(findH));
    });

    if (csvMatch) {
        return res.json({ results: [csvMatch], entities: [h, d] });
    }

    // --- NEW LOGIC: ENZYME OVERLAP CHECK (MECHANISM PULL) ---
    const hProf = herbProfiles[h.toLowerCase()];
    const dProf = drugProfiles[d.toLowerCase()];
    let overlapMechanism = "";
    if (hProf?.enzymes && dProf?.enzymes) {
        const overlap = hProf.enzymes.filter(e => dProf.enzymes.includes(e));
        if (overlap.length > 0) {
            overlapMechanism = `Potential competition at metabolic pathway: ${overlap.join(', ')}.`;
        }
    }

    // Waterfall 2: PubMed & Trained BioBERT
    const pCount = await fetchPubMed(h, d);
    const aiResponse = await queryBioBERT(text);

    // AI Confidence Logic Fix: Calculate score even if pCount exists
    let aiScore = 0;
    let hasAIInteraction = false;
    if (Array.isArray(aiResponse) && aiResponse[0] && aiResponse[0][0]) {
        hasAIInteraction = aiResponse[0][0].label === "LABEL_1";
        aiScore = Math.round(aiResponse[0][0].score * 100);
    }

    if (pCount > 0 || hasAIInteraction) {
        return res.json({
            results: [{
                source: `BioBERT AI Prediction (Confidence: ${aiScore}%)`,
                severity: "MODERATE (AI Predicted)",
                clinical_effect: pCount > 0 
                    ? `Found ${pCount} literature matches. ${overlapMechanism || "Interaction patterns detected."}` 
                    : `AI identified high-risk pharmacokinetic interaction. ${overlapMechanism || ""}`,
                recommendation: "Consult a clinical pharmacist. Monitor for changes in drug efficacy or toxicity.",
                pubmed_count: pCount
            }],
            entities: [h, d]
        });
    }

    res.json({ results: [], entities: [h, d], message: "No interaction found in local DB or AI analysis." });
});

const PORT = process.env.PORT || 10000;
loadCSV().then(() => {
    app.listen(PORT, '0.0.0.0', () => console.log(`🚀 CDSS Online`));
});
