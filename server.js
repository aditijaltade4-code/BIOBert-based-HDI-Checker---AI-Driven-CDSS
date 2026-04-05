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
const MASTER_CSV_PATH = path.join(__dirname, 'data', 'HDI_Master_List.csv'); 
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
   3. MASTER DATA LOADER
   ----------------------- */
async function loadCSV() {
    return new Promise((resolve) => {
        if (!fs.existsSync(MASTER_CSV_PATH)) {
            console.error(`❌ Master File not found`);
            return resolve(); 
        }
        const results = [];
        fs.createReadStream(MASTER_CSV_PATH)
            .pipe(csv())
            .on('data', (row) => {
                const getVal = (obj, target) => {
                    const key = Object.keys(obj).find(k => k.trim().toLowerCase() === target.toLowerCase());
                    return key ? obj[key] : '';
                };
                const herb = getVal(row, 'Herb Name').trim();
                const drug = getVal(row, 'Drug Name').trim();
                if (herb && drug) {
                    results.push({
                        herb: herb.toLowerCase(),
                        drug: drug.toLowerCase(),
                        herb_display: herb,
                        drug_display: drug,
                        scientific_name: getVal(row, 'Scientific Name'),
                        active_ingredients: getVal(row, 'Active Ingredients'),
                        drug_class: getVal(row, 'Drug Class'),
                        enzyme: getVal(row, 'Enzyme Target'),
                        mechanism_type: getVal(row, 'Mechanism Type'),
                        interaction_type: getVal(row, 'Interactiom Type'),
                        clinical_effect: getVal(row, 'Clinical Effect'),
                        severity: getVal(row, 'Severity'),
                        evidence: getVal(row, 'Evidence Level'),
                        recommendation: getVal(row, 'Clinical Reccomendation'),
                        reference: getVal(row, 'Reference')
                    });
                }
            })
            .on('end', () => {
                interactionsDB = results;
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
        const cleanInput = text.toLowerCase();
        let rawDetected = [];

        // 1. Safety Regex Scan (Deterministic)
        Object.keys(SYNONYM_BRIDGE).forEach(key => {
            const regex = new RegExp(`\\b${key}\\b`, 'gi');
            if (regex.test(cleanInput)) rawDetected.push(key);
        });

        // 2. BioBERT NER (Probabilistic)
        const hfResponse = await fetch(HF_API_URL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${HF_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ inputs: text })
        });
        const apiResults = await hfResponse.json();

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

        // 3. STRICT NORMALIZATION & DEDUPLICATION
        // This converts everything ("haridra", "haldi", etc.) into "Curcumin"
        let finalEntities = [];
        rawDetected.forEach(word => {
            const wordClean = word.toLowerCase().trim();
            const standardized = SYNONYM_BRIDGE[wordClean] || word.charAt(0).toUpperCase() + word.slice(1);
            
            if (!finalEntities.includes(standardized) && standardized.length > 2) {
                finalEntities.push(standardized);
            }
        });

        console.log(`🧠 Standardized Entities: ${finalEntities}`);

        // 4. CROSS-MATCHING SEARCH
        await loadCSV();
        let uiResults = [];

        if (finalEntities.length >= 2) {
            // We loop through all pairs in case the user mentioned 3+ things
            for (let i = 0; i < finalEntities.length; i++) {
                for (let j = i + 1; j < finalEntities.length; j++) {
                    const term1 = finalEntities[i].toLowerCase();
                    const term2 = finalEntities[j].toLowerCase();

                    const matches = interactionsDB.filter(item => 
                        (item.herb.includes(term1) || term1.includes(item.herb) || item.herb.includes(term2) || term2.includes(item.herb)) &&
                        (item.drug.includes(term1) || term1.includes(item.drug) || item.drug.includes(term2) || term2.includes(item.drug))
                    );
                    uiResults.push(...matches);
                }
            }
        }

        // 5. Fallback if no CSV match found
        if (uiResults.length === 0 && finalEntities.length >= 2) {
            uiResults.push({
                herb_display: finalEntities[0],
                drug_display: finalEntities[1],
                clinical_effect: "Potential interaction identified by neural mapping.",
                severity: "Clinical Alert",
                recommendation: "Review co-administration; specific data not in master CSV.",
                evidence: "BioBERT Prediction"
            });
        }

        res.json({ results: uiResults, detected_entities: finalEntities });

    } catch (error) {
        res.status(500).json({ error: "System Error", results: [] });
    }
});

const PORT = process.env.PORT || 10000;
loadCSV().then(() => {
    app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Master CDSS Online`));
});
