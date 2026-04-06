const express = require('express');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const fetch = require('node-fetch');

// require('dotenv').config(); 

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// --- 1. DATA PATHS (Strict Absolute Paths for Linux/Render) ---
const CSV_PATH = path.resolve(__dirname, 'data', 'HDI_Master_List.csv');
let interactionsDB = [];
let herbProfiles = {};
let drugProfiles = {};

// Load JSON Profiles
try {
    herbProfiles = require(path.resolve(__dirname, 'herb_profiles.json'));
    drugProfiles = require(path.resolve(__dirname, 'drug_profiles.json'));
    console.log("✅ Herb/Drug JSON Profiles Loaded");
} catch (e) { 
    console.warn("⚠️ JSON profiles missing. Waterfall 3 will be limited."); 
}

// --- 2. SYNONYM BRIDGE ---
const SYNONYM_BRIDGE = {
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

// --- 3. EXTERNAL API (FIXED FOR ROUTER ERRORS) ---
async function queryBioBERT(text) {
    const token = process.env.HF_TOKEN;
    if (!token) return null;

    // Use the standard inference endpoint which is more stable for custom models
    const MODEL_URL = "https://api-inference.huggingface.co/models/aditijaltade4/BIOBert-based-HDI-Checker";

    try {
        console.log("📡 Querying BioBERT...");
        const response = await fetch(MODEL_URL, {
            headers: { 
                "Authorization": `Bearer ${token.trim()}`, 
                "Content-Type": "application/json" 
            },
            method: "POST",
            body: JSON.stringify({ inputs: text, options: { wait_for_model: true } }),
        });

        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            const rawError = await response.text();
            console.error(`❌ AI Response Not JSON (${response.status}): ${rawError}`);
            return null;
        }

        const resJson = await response.json();
        return resJson;
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

// --- 4. DATA LOADER (REPAIRED FOR FLEXIBLE COLUMNS) ---
async function loadCSV() {
    return new Promise((resolve) => {
        if (!fs.existsSync(CSV_PATH)) {
            console.error(`❌ CSV FILE MISSING: ${CSV_PATH}`);
            return resolve();
        }

        interactionsDB = [];
        fs.createReadStream(CSV_PATH)
            .pipe(csv({ 
                mapHeaders: ({ header }) => header.trim().toLowerCase().replace(/[^\x20-\x7E]/g, '') 
            }))
            .on('data', (row) => {
                // Find column names even if they aren't exactly 'herb' or 'drug'
                const hKey = Object.keys(row).find(k => k.includes('herb'));
                const dKey = Object.keys(row).find(k => k.includes('drug'));
                const eKey = Object.keys(row).find(k => k.includes('effect') || k.includes('clinical'));

                if (row[hKey] && row[dKey]) {
                    interactionsDB.push({
                        herb: row[hKey].toLowerCase().trim(),
                        drug: row[dKey].toLowerCase().trim(),
                        clinical_effect: row[eKey] || "Potential interaction noted.",
                        severity: row['severity'] || "Moderate",
                        source: "HD Master Database"
                    });
                }
            })
            .on('end', () => {
                console.log(`✅ DATABASE READY: ${interactionsDB.length} records loaded.`);
                resolve();
            });
    });
}

// --- 5. ROUTES ---
app.post('/api/analyze-text', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "No input." });

    const input = text.toLowerCase();
    let detectedHerbs = [];
    let detectedDrugs = [];

    // Entity Recognition
    Object.keys(SYNONYM_BRIDGE).forEach(key => {
        if (new RegExp(`\\b${key}\\b`, 'gi').test(input)) {
            const entry = SYNONYM_BRIDGE[key];
            if (entry.type === 'herb' && !detectedHerbs.includes(entry.name)) detectedHerbs.push(entry.name);
            else if (entry.type === 'drug' && !detectedDrugs.includes(entry.name)) detectedDrugs.push(entry.name);
        }
    });

    const h = detectedHerbs[0] || "unknown";
    const d = detectedDrugs[0] || "unknown";

    if (h === "unknown" || d === "unknown") {
        return res.json({ results: [], entities: [h, d], message: "Please specify both a herb and a drug." });
    }

  // --- WATERFALL 1: CSV (REPAIRED) ---
console.log(`[W1] Searching CSV for: ${h} + ${d}`);

const csvMatch = interactionsDB.find(i => {
    // 1. Clean everything to be safe
    const dbHerb = i.herb.toLowerCase().trim();
    const dbDrug = i.drug.toLowerCase().trim();
    const userHerb = h.toLowerCase().trim();
    const userDrug = d.toLowerCase().trim();

    // 2. Check for both A+B and B+A combinations
    // We use .includes() so "Metformin Hydrochloride" matches "Metformin"
    const matchNormal = (dbHerb.includes(userHerb) && dbDrug.includes(userDrug));
    const matchReverse = (dbHerb.includes(userDrug) && dbDrug.includes(userHerb));

    return matchNormal || matchReverse;
});

if (csvMatch) {
    console.log("✅ [W1] MATCH FOUND IN CSV:", csvMatch.herb, "+", csvMatch.drug);
    return res.json({ 
        results: [csvMatch], 
        entities: [h, d] 
    });
} else {
    console.log(`❌ [W1] No match in ${interactionsDB.length} records. Moving to AI...`);
}

    // --- WATERFALL 2: BioBERT & PubMed ---
console.log(`[W2] Falling through to AI for: ${h} + ${d}`);
try {
    const [aiResponse, pCount] = await Promise.all([queryBioBERT(text), fetchPubMed(h, d)]);
    let aiScore = 0;
    let hasAI = false;

    // --- UPDATED AI PARSER START ---
    if (Array.isArray(aiResponse) && aiResponse.length > 0) {
        console.log("🤖 Raw AI Data:", JSON.stringify(aiResponse)); // Debugging log

        // Check if ANY part of the AI response mentions an interaction
        const riskEntry = aiResponse.find(item => 
            (item.entity_group === 'INTERACTION' || item.label === 'LABEL_1' || item.label === 'INTERACT') && 
            item.score > 0.4
        );

        if (riskEntry) {
            hasAI = true;
            aiScore = Math.round(riskEntry.score * 100);
        }
    }
    // --- UPDATED AI PARSER END ---

    if (hasAI || pCount > 0) {
        return res.json({
            results: [{
                source: `BioBERT AI (Confidence: ${aiScore}%)`,
                severity: aiScore > 70 ? "HIGH" : "MODERATE",
                clinical_effect: pCount > 0 
                    ? `AI predicted interaction. PubMed found ${pCount} matching studies.` 
                    : "BioBERT model identified a high-risk pharmacokinetic/dynamic pattern.",
                recommendation: "Clinical monitoring or dose adjustment advised.",
                mechanism: "BioBERT Relation Extraction",
                evidence: pCount > 0 ? "PubMed Hybrid" : "In-silico Prediction"
            }],
            entities: [h, d]
        });
    }
} catch (e) { 
    console.error("AI Waterfall Error:", e); 
}

    // WATERFALL 3: ENZYME LOGIC
    const hP = herbProfiles[h.toLowerCase()];
    const dP = drugProfiles[d.toLowerCase()];
    if (hP?.enzymes && dP?.enzymes) {
        const overlap = hP.enzymes.filter(e => dP.enzymes.includes(e));
        if (overlap.length > 0) {
            return res.json({
                results: [{
                    source: "Enzyme Overlap Engine",
                    severity: "THEORETICAL",
                    clinical_effect: `Shared metabolic pathway: ${overlap.join(', ')}.`
                }],
                entities: [h, d]
            });
        }
    }

    res.json({ results: [], entities: [h, d], message: "No documented interaction found." });
});

app.get('/api/list-all', (req, res) => res.json(interactionsDB));

const PORT = process.env.PORT || 10000;
loadCSV().then(() => {
    app.listen(PORT, '0.0.0.0', () => console.log(`🚀 CDSS Online on Port ${PORT}`));
});
