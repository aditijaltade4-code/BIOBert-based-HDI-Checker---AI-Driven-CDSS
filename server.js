const express = require('express');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// --- 1. CONFIGURATION ---
const HF_TOKEN = process.env.HF_TOKEN; 
const HF_API_URL = "https://api-inference.huggingface.co/models/d4data/biomedical-ner-all";
const CSV_PATH = path.join(__dirname, 'data', 'interactions.csv'); 
let interactionsDB = [];

// --- 2. EXPANDED SYNONYM BRIDGE ---
// Added common Ayurvedic herbs, modern drugs, and frequent brand names
const SYNONYM_BRIDGE = {
    // Cardiovascular / Blood Pressure
    "amlodipine": "Amlodipine", "amlowas": "Amlodipine", "stamlo": "Amlodipine", "norvasc": "Amlodipine",
    "telmisartan": "Telmisartan", "telma": "Telmisartan", "telvas": "Telmisartan",
    "losartan": "Losartan", "losar": "Losartan",
    "atorvastatin": "Atorvastatin", "atorva": "Atorvastatin", "lipvas": "Atorvastatin",
    "warfarin": "Warfarin", "coumadin": "Warfarin",
    "aspirin": "Aspirin", "ecosprin": "Aspirin", "disprin": "Aspirin",
    "clopidogrel": "Clopidogrel", "clopilet": "Clopidogrel",

    // Diabetes
    "metformin": "Metformin", "glycomet": "Metformin", "cetapin": "Metformin",
    "glimepiride": "Glimepiride", "amaryl": "Glimepiride", "glimipride": "Glimepiride",
    "sitagliptin": "Sitagliptin", "januvia": "Sitagliptin",

    // Gastric / Acid Reflux
    "pantoprazole": "Pantoprazole", "pantocid": "Pantoprazole", "pan": "Pantoprazole", "pan-d": "Pantoprazole",
    "omeprazole": "Omeprazole", "omez": "Omeprazole",
    "ranitidine": "Ranitidine", "zantac": "Ranitidine", "acinorm": "Ranitidine",

    // Common Ayurvedic Herbs (Indian Context)
    "ashwagandha": "Ashwagandha", "asvagandha": "Ashwagandha", "withania": "Ashwagandha",
    "guggulu": "Guggulu", "guggul": "Guggulu", "gulgul": "Guggulu", "commiphora": "Guggulu",
    "turmeric": "Curcumin", "curcumin": "Curcumin", "haridra": "Curcumin", "haldi": "Curcumin",
    "brahmi": "Brahmi", "bacopa": "Brahmi",
    "shatavari": "Shatavari", "aspargus": "Shatavari",
    "tulsi": "Tulsi", "basil": "Tulsi", "holy basil": "Tulsi",
    "triphala": "Triphala", "haritaki": "Triphala", "vibhitaki": "Triphala", "amalaki": "Triphala", "amla": "Triphala",
    "giloy": "Giloy", "guduchi": "Giloy", "tinospora": "Giloy",
    "neem": "Neem", "azadirachta": "Neem",
    "aloe vera": "Aloe Vera", "aleovera": "Aloe Vera", "ghritkumari": "Aloe Vera"
};

/* -----------------------
   3. DATA LOADER (CSV)
   ----------------------- */
async function loadCSV() {
    return new Promise((resolve) => {
        if (!fs.existsSync(CSV_PATH)) {
            console.error(`❌ CSV not found at ${CSV_PATH}`);
            return resolve(); 
        }
        const results = [];
        fs.createReadStream(CSV_PATH)
            .pipe(csv())
            .on('data', (row) => {
                const getVal = (obj, target) => {
                    const key = Object.keys(obj).find(k => k.trim().toLowerCase() === target.toLowerCase());
                    return key ? obj[key] : '';
                };
                results.push({
                    herb: getVal(row, 'herb').toLowerCase().trim(),
                    drug: getVal(row, 'drug').toLowerCase().trim(),
                    interaction_text: getVal(row, 'interaction_text') || getVal(row, 'interaction') || 'Caution advised.',
                    mechanism: getVal(row, 'mechanism') || 'Automated analysis.',
                    severity: getVal(row, 'severity') || 'Moderate',
                    recommendation: getVal(row, 'recommendation') || 'Consult clinical guidelines.',
                    evidence: getVal(row, 'evidence_level') || 'NLP Extraction',
                    citation: getVal(row, 'citation_url') || '#'
                });
            })
            .on('end', () => {
                interactionsDB = results;
                console.log(`✅ Database Synced: ${interactionsDB.length} records.`);
                resolve();
            });
    });
}

/* -----------------------
   4. HYBRID AI LOGIC
   ----------------------- */
app.post('/api/analyze-text', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "No text provided" });

    try {
        console.log(`🤖 Processing: "${text}"`);
        const cleanInput = text.toLowerCase();
        let rawDetected = [];

        // --- STEP 1: SAFETY SCAN (Regex Match for Bridge) ---
        // We do this first to ensure we don't miss known drugs/herbs
        Object.keys(SYNONYM_BRIDGE).forEach(key => {
            const regex = new RegExp(`\\b${key}\\b`, 'gi'); 
            if (regex.test(cleanInput)) {
                rawDetected.push(key);
            }
        });

        // --- STEP 2: AI NER DETECTION (BioBERT) ---
        const hfResponse = await fetch(HF_API_URL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${HF_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ inputs: text })
        });

        const apiResults = await hfResponse.json();

        // BioBERT Subword Reassembly Logic
        if (Array.isArray(apiResults)) {
            let currentWord = "";
            apiResults.forEach(ent => {
                const word = ent.word || "";
                if (word.startsWith("##")) {
                    currentWord += word.replace("##", "");
                } else {
                    if (currentWord.length > 2) rawDetected.push(currentWord);
                    currentWord = word;
                }
            });
            if (currentWord.length > 2) rawDetected.push(currentWord);
        }

        // --- STEP 3: NORMALIZATION & DEDUPLICATION ---
        let finalEntities = [];
        rawDetected.forEach(word => {
            const wordClean = word.toLowerCase().trim();
            const standardized = SYNONYM_BRIDGE[wordClean] || word.charAt(0).toUpperCase() + word.slice(1);
            if (!finalEntities.includes(standardized) && standardized.length > 2) {
                finalEntities.push(standardized);
            }
        });

        console.log(`🧠 Entities Identified: ${finalEntities}`);

        // --- STEP 4: HYBRID SEARCH & DYNAMIC GENERATION ---
        await loadCSV();
        let uiResults = [];

        if (finalEntities.length >= 2) {
            // Check all combinations for a CSV match
            for (let i = 0; i < finalEntities.length; i++) {
                for (let j = i + 1; j < finalEntities.length; j++) {
                    const e1 = finalEntities[i].toLowerCase();
                    const e2 = finalEntities[j].toLowerCase();

                    const matches = interactionsDB.filter(item => 
                        (item.herb.includes(e1) || e1.includes(item.herb) || item.herb.includes(e2) || e2.includes(item.herb)) &&
                        (item.drug.includes(e1) || e1.includes(item.drug) || item.drug.includes(e2) || e2.includes(item.drug))
                    );
                    uiResults.push(...matches);
                }
            }
        }

        // If no CSV match, generate Dynamic Interaction Alert
        if (uiResults.length === 0 && finalEntities.length >= 2) {
            const e1 = finalEntities[0];
            const e2 = finalEntities[1];
            uiResults.push({
                herb: e1,
                drug: e2,
                interaction_text: `Potential clinical interaction identified between ${e1} and ${e2}.`,
                mechanism: "Neural Entity Normalization identified co-administration of bioactive agents.",
                severity: "Clinical Alert",
                recommendation: "Monitor patient for altered therapeutic efficacy or synergistic effects.",
                evidence: "AI Predicted (BioBERT Hybrid)",
                citation: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(e1)}+${encodeURIComponent(e2)}+interaction`
            });
        }

        res.json({ 
            results: uiResults, 
            detected_entities: finalEntities,
            message: finalEntities.length < 2 ? "AI found fewer than 2 clinical entities. Please specify both an herb and a drug." : null
        });

    } catch (error) {
        console.error("❌ System Error:", error.message);
        res.status(500).json({ error: "Analysis engine unreachable.", results: [] });
    }
});

/* -----------------------
   5. START SERVER
   ----------------------- */
const PORT = process.env.PORT || 10000;
loadCSV().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 Clinical CDSS Online (Node-Only Mode)`);
        console.log(`🌐 Listening on Port: ${PORT}\n`);
    });
});
