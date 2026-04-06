const express = require('express');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const fetch = require('node-fetch');

// If you are using a .env file locally, uncomment the line below:
// require('dotenv').config(); 

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// --- 1. DATA PATHS (Force Absolute Paths for Windows/Render) ---
const CSV_PATH = path.resolve(__dirname, 'data', 'HDI_Master_List.csv');
let interactionsDB = [];
let herbProfiles = {};
let drugProfiles = {};

try {
    herbProfiles = require(path.resolve(__dirname, 'herb_profiles.json'));
    drugProfiles = require(path.resolve(__dirname, 'drug_profiles.json'));
    console.log("✅ Herb/Drug JSON Profiles Loaded");
} catch (e) { 
    console.warn("⚠️ JSON profiles missing or malformed."); 
}

// --- 2. THE COMPREHENSIVE SYNONYM BRIDGE ---
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

// --- 3. EXTERNAL API LOGIC (FIXED FOR HF ROUTER PIPELINES) ---
async function queryBioBERT(text) {
    const token = process.env.HF_TOKEN;
    if (!token) {
        console.error("❌ BioBERT Error: HF_TOKEN missing.");
        return null;
    }

    // FIXED: Appended pipeline task to satisfy the new HF Router requirements
    const MODEL_URL = "https://router.huggingface.co/hf-inference/models/aditijaltade4/BIOBert-based-HDI-Checker/pipeline/token-classification";

    try {
        console.log("📡 Querying BioBERT via Hugging Face Router...");
        const response = await fetch(MODEL_URL, {
            headers: { 
                "Authorization": `Bearer ${token.trim()}`, 
                "Content-Type": "application/json" 
            },
            method: "POST",
            body: JSON.stringify({ inputs: text, options: { wait_for_model: true } }),
        });

        // SAFETY: Check if response is valid JSON to prevent "Unexpected token N"
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            const rawError = await response.text();
            console.error(`❌ API Error (${response.status}): ${rawError}`);
            return null;
        }

        const resJson = await response.json();
        console.log("🤖 AI Response Received:", JSON.stringify(resJson));

        if (resJson.error) {
            console.error("⚠️ Hugging Face Error:", resJson.error);
            return null;
        }

        return resJson;
    } catch (e) { 
        console.error("❌ BioBERT Connection Error:", e.message);
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

// --- 4. DATA LOADER (REPAIRED FOR WINDOWS/BOM) ---
async function loadCSV() {
    return new Promise((resolve) => {
        if (!fs.existsSync(CSV_PATH)) {
            console.error(`❌ CSV NOT FOUND: ${CSV_PATH}`);
            return resolve();
        }

        interactionsDB = [];
        fs.createReadStream(CSV_PATH)
            .pipe(csv({ 
                mapHeaders: ({ header }) => header.trim().toLowerCase().replace(/[^\x20-\x7E]/g, '') 
            }))
            .on('data', (row) => {
                const entry = {
                    herb: (row['herb'] || row['herb name'] || "").toLowerCase().trim(),
                    drug: (row['drug'] || row['drug name'] || "").toLowerCase().trim(),
                    clinical_effect: row['clinical_effect'] || row['effect'] || "No effect documented.",
                    recommendation: row['recommendation'] || row['recom'] || "Monitor status.",
                    severity: row['severity'] || "Moderate",
                    mechanism: row['mechanism'] || "N/A",
                    interaction_type: row['type'] || "N/A",
                    evidence: row['evidence'] || "N/A",
                    pk_pd: row['pkpd'] || row['pk_pd'] || "N/A",
                    source: "HD Master Database"
                };
                if (entry.herb && entry.drug) interactionsDB.push(entry);
            })
            .on('end', () => {
                console.log(`✅ DATABASE LOADED: ${interactionsDB.length} records.`);
                resolve();
            });
    });
}

// --- 5. ROUTES ---
app.post('/api/analyze-text', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "No input provided." });

    const input = text.toLowerCase();
    let detectedHerbs = [];
    let detectedDrugs = [];

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
        return res.json({ results: [], entities: [h, d], message: "Identify both a herb and a drug." });
    }

    // WATERFALL 1: CSV
    console.log(`[W1] Searching CSV for: ${h} + ${d}`);
    const csvMatch = interactionsDB.find(i => 
        (i.herb.includes(h.toLowerCase()) && i.drug.includes(d.toLowerCase())) || 
        (i.herb.includes(d.toLowerCase()) && i.drug.includes(h.toLowerCase()))
    );

    if (csvMatch && csvMatch.clinical_effect !== "No effect documented.") {
        return res.json({ results: [csvMatch], entities: [h, d] });
    }

    // WATERFALL 2: BioBERT & PubMed
    console.log(`[W2] Falling through to AI for: ${h} + ${d}`);
    try {
        const [aiResponse, pCount] = await Promise.all([queryBioBERT(text), fetchPubMed(h, d)]);
        let aiScore = 0;
        let hasAI = false;

        if (Array.isArray(aiResponse) && aiResponse.length > 0) {
            // Logic for token-classification or sequence-classification labels
            const firstResult = Array.isArray(aiResponse[0]) ? aiResponse[0][0] : aiResponse[0];
            hasAI = firstResult.label === "LABEL_1" || firstResult.label === "INTERACTION" || firstResult.score > 0.5;
            aiScore = Math.round(firstResult.score * 100);
        }

        if (hasAI || pCount > 0) {
            return res.json({
                results: [{
                    source: `BioBERT AI (Confidence: ${aiScore}%)`,
                    severity: "MODERATE (AI Predicted)",
                    clinical_effect: pCount > 0 ? `AI detected interaction. PubMed found ${pCount} matches.` : "AI model identified high-risk interaction pattern.",
                    recommendation: "Clinical monitoring advised.",
                    mechanism: "NLP Pattern Recognition.",
                    pubmed_count: pCount,
                    evidence: pCount > 0 ? "PubMed Matches" : "In-silico Prediction"
                }],
                entities: [h, d]
            });
        }
    } catch (e) { console.error("AI Waterfall Error:", e); }

    // WATERFALL 3: Enzyme Overlap
    const hProf = herbProfiles[h.toLowerCase()];
    const dProf = drugProfiles[d.toLowerCase()];
    if (hProf?.enzymes && dProf?.enzymes) {
        const overlap = hProf.enzymes.filter(e => dProf.enzymes.includes(e));
        if (overlap.length > 0) {
            return res.json({
                results: [{
                    source: "Pharmacokinetic Logic Engine",
                    severity: "THEORETICAL",
                    clinical_effect: `Overlap detected on: ${overlap.join(', ')}.`,
                    mechanism: `Potential metabolic competition.`,
                    recommendation: "Monitor drug levels.",
                    evidence: "PK Mapping"
                }],
                entities: [h, d]
            });
        }
    }

    res.json({ results: [], entities: [h, d], message: "No interaction detected." });
});

app.get('/api/list-all', (req, res) => res.json(interactionsDB));

const PORT = process.env.PORT || 10000;
loadCSV().then(() => {
    app.listen(PORT, '0.0.0.0', () => console.log(`🚀 CDSS Online on Port ${PORT}`));
});
