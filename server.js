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

async function loadCSV() {
    return new Promise((resolve) => {
        // 1. Check if file actually exists
        if (!fs.existsSync(CSV_PATH)) {
            console.error(`❌ FILE NOT FOUND: Check this path -> ${CSV_PATH}`);
            return resolve();
        }

        console.log("📂 File found. Starting stream...");
        interactionsDB = [];

        fs.createReadStream(CSV_PATH)
            .pipe(csv({ 
                mapHeaders: ({ header }) => header.trim().toLowerCase() // Force headers to lowercase
            }))
            .on('data', (row) => {
                // 2. Log the first row to see exactly what the keys look like
                if (interactionsDB.length === 0) {
                    console.log("📝 First row keys detected:", Object.keys(row));
                }

                // Map keys using the lowercase version we forced above
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

                if (entry.herb && entry.drug) {
                    interactionsDB.push(entry);
                }
            })
            .on('error', (err) => {
                console.error("❌ STREAM ERROR:", err.message);
            })
            .on('end', () => {
                if (interactionsDB.length === 0) {
                    console.warn("⚠️ DATA LOADED: 0 records. Is the CSV empty or headers mismatched?");
                } else {
                    console.log(`✅ SUCCESS: ${interactionsDB.length} records loaded into memory.`);
                }
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

    // 1. Entity Detection (Synonym Bridge)
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
        return res.json({ results: [], entities: [h, d], message: "Please identify a specific herb and drug." });
    }

    // --- STEP 1: CSV MASTER DATABASE ---
    console.log(`[Waterfall 1] Checking CSV for ${h} + ${d}`);
    const csvMatch = interactionsDB.find(i => {
        const dbH = i.herb.toLowerCase();
        const dbD = i.drug.toLowerCase();
        return (dbH.includes(h.toLowerCase()) && dbD.includes(d.toLowerCase())) || 
               (dbH.includes(d.toLowerCase()) && dbD.includes(h.toLowerCase()));
    });

    // Check if CSV match is actually valid/populated
    if (csvMatch && csvMatch.clinical_effect && csvMatch.clinical_effect !== "No effect documented.") {
        console.log("✅ CSV Match Found.");
        return res.json({ results: [csvMatch], entities: [h, d] });
    }

    // --- STEP 2: BioBERT AI & PUBMED (Triggered if CSV fails) ---
    console.log(`[Waterfall 2] CSV failed. Triggering BioBERT & PubMed for ${h} + ${d}`);
    
    try {
        const [aiResponse, pCount] = await Promise.all([
            queryBioBERT(text),
            fetchPubMed(h, d)
        ]);

        let aiScore = 0;
        let hasAIInteraction = false;
        
        // Validation for BioBERT response format
        if (Array.isArray(aiResponse) && aiResponse[0] && aiResponse[0][0]) {
            const topResult = aiResponse[0][0];
            // Ensure we only trigger if confidence is high or label is positive
            hasAIInteraction = topResult.label === "LABEL_1" || topResult.score > 0.6;
            aiScore = Math.round(topResult.score * 100);
        }

        if (hasAIInteraction || pCount > 0) {
            console.log("✅ BioBERT/PubMed Match Found.");
            return res.json({
                results: [{
                    source: `BioBERT AI Prediction (Confidence: ${aiScore}%)`,
                    severity: "MODERATE (AI Predicted)",
                    clinical_effect: pCount > 0 
                        ? `AI detected potential interaction. Literature check found ${pCount} relevant PubMed results.` 
                        : "AI model identified high-probability pharmacokinetic interaction pattern.",
                    recommendation: "Clinical consultation recommended. Monitor patient for unexpected side effects.",
                    mechanism: "NLP-based biomedical pattern recognition.",
                    pubmed_count: pCount,
                    evidence: pCount > 0 ? "PubMed Matches" : "In-silico Prediction"
                }],
                entities: [h, d]
            });
        }
    } catch (err) {
        console.error("❌ BioBERT/PubMed Error:", err);
    }

    // --- STEP 3: PK ENZYME OVERLAP (Last Resort) ---
    console.log(`[Waterfall 3] AI failed. Checking Enzyme Overlap for ${h} + ${d}`);
    const hProf = herbProfiles[h.toLowerCase()];
    const dProf = drugProfiles[d.toLowerCase()];
    
    if (hProf?.enzymes && dProf?.enzymes) {
        const overlap = hProf.enzymes.filter(e => dProf.enzymes.includes(e));
        if (overlap.length > 0) {
            console.log("✅ Enzyme Overlap Found.");
            return res.json({
                results: [{
                    source: "Pharmacokinetic Logic",
                    severity: "THEORETICAL",
                    clinical_effect: `Shared metabolic pathways detected: ${overlap.join(', ')}.`,
                    mechanism: `Potential competitive metabolism via ${overlap.join(', ')}.`,
                    recommendation: "Theoretical interaction. Monitor drug plasma levels if possible.",
                    evidence: "PK Mapping"
                }],
                entities: [h, d]
            });
        }
    }

    // --- FINAL FALLBACK ---
    console.log("❌ No Interaction Detected in Waterfall.");
    res.json({ 
        results: [], 
        entities: [h, d], 
        message: "No interaction found in local database, AI analysis, or enzyme profiles." 
    });
});

const PORT = process.env.PORT || 10000;
loadCSV().then(() => {
    app.listen(PORT, '0.0.0.0', () => console.log(`🚀 CDSS Online on Port ${PORT}`));
});
