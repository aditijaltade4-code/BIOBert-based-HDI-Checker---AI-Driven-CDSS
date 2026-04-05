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

// --- 2. THE SYNONYM BRIDGE (EXTRACTED FROM YOUR PYTHON) ---
const SYNONYM_BRIDGE = {
    "glimipride": "Glimepiride", "glimepiride": "Glimepiride", "amaryl": "Glimepiride",
    "glycomet": "Metformin", "metformin": "Metformin",
    "omez": "Pantoprazole", "pantoprazole": "Pantoprazole", "pan-d": "Pantoprazole",
    "pantocid": "Pantoprazole", "omeprazole": "Pantoprazole",
    "aspirin": "Aspirin", "ecosprin": "Aspirin", "disprin": "Aspirin",
    "warfarin": "Warfarin", "coumadin": "Warfarin",
    "furosemide": "Furosemide", "lasix": "Furosemide",
    "turmeric": "Curcumin", "curcumin": "Curcumin", "haridra": "Curcumin",
    "aloe vera": "Aloe Vera", "aleovera": "Aloe Vera", "ghritkumari": "Aloe Vera",
    "ashwagandha": "Ashwagandha", "asvagandha": "Ashwagandha",
    "gallic acid": "Gallic Acid", "gallic": "Gallic Acid",
    "triphala": "Triphala", "haritaki": "Triphala", "vibhitaki": "Triphala", "amalaki": "Triphala",
    "guggulu": "Guggulu", "gulgul": "Guggulu", "guggul": "Guggulu"
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
   4. HYBRID AI LOGIC (PORTED FROM PYTHON)
   ----------------------- */
app.post('/api/analyze-text', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "No text provided" });

    try {
        console.log(`🤖 Processing: "${text}"`);
        const cleanInput = text.toLowerCase();
        
        // --- STEP 1: AI NER DETECTION (Calling HuggingFace Directly) ---
        const hfResponse = await fetch(HF_API_URL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${HF_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ inputs: text })
        });

        const apiResults = await hfResponse.json();
        let rawDetected = [];

        // BioBERT Subword Reassembly Logic (Ported from Python)
        if (Array.isArray(apiResults)) {
            let currentWord = "";
            apiResults.forEach(ent => {
                const word = ent.word || "";
                if (word.startsWith("##")) {
                    currentWord += word.replace("##", "");
                } else {
                    if (currentWord) rawDetected.push(currentWord);
                    currentWord = word;
                }
            });
            if (currentWord) rawDetected.push(currentWord);
        }

        // --- STEP 2: KEYWORD SCANNER (Matches manual inputs/synonyms) ---
        Object.keys(SYNONYM_BRIDGE).forEach(key => {
            if (cleanInput.includes(key) && !rawDetected.some(w => w.toLowerCase() === key)) {
                rawDetected.push(key);
            }
        });

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
        
        // First, check for an exact pair match in our CSV
        let uiResults = [];
        if (finalEntities.length >= 2) {
            const e1 = finalEntities[0].toLowerCase();
            const e2 = finalEntities[1].toLowerCase();

            uiResults = interactionsDB.filter(item => 
                (item.herb.includes(e1) || e1.includes(item.herb)) &&
                (item.drug.includes(e2) || e2.includes(item.drug))
            );
        }

        // If no CSV match, generate the Dynamic Interaction (Ported from Python)
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
