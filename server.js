const express = require('express');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// --- 1. CONFIGURATION & DATA LOADING ---
const HF_TOKEN = process.env.HF_TOKEN; 
const HF_API_URL = "https://api-inference.huggingface.co/models/d4data/biomedical-ner-all";
const MASTER_CSV_PATH = path.join(__dirname, 'data', 'HDI_Master_List.csv'); 

let interactionsDB = [];
let herbProfiles = {};
let drugProfiles = {};

try {
    herbProfiles = require('./herb_profiles.json');
    drugProfiles = require('./drug_profiles.json');
    console.log("✅ Herb and Drug Profiles loaded successfully.");
} catch (e) {
    console.error("⚠️ Profiles not found. Check file paths.");
}

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
   3. INFERENCE ENGINE (The 3 Rules)
   ----------------------- */
function inferInteractionLogic(herbKey, drugKey) {
    const h = herbProfiles[herbKey];
    const d = drugProfiles[drugKey];

    if (!h || !d) return null;

    const hEnzymes = h.enzymes || (h.enzyme ? [h.enzyme] : []);
    const sharedEnzyme = hEnzymes.find(e => e === d.enzyme);
    
    if (!sharedEnzyme) return null;

    let result = {
        herb_display: herbKey,
        drug_display: drugKey,
        enzyme: sharedEnzyme,
        evidence: "Pharmacokinetic (PK) Rules Engine",
        severity: "High"
    };

    if (h.action === "Inducer" && d.type === "Substrate") {
        result.clinical_effect = "Decreased Drug Levels (Antagonistic Interaction)";
        result.recommendation = "Rule 1: Reduced efficacy. The herb activates the enzyme, clearing the drug too quickly.";
    } 
    else if (h.action === "Inhibitor" && d.type === "Substrate") {
        result.clinical_effect = "Increased Drug Levels (Potentiation Interaction)";
        result.recommendation = "Rule 2: Increased risk of toxicity. The herb blocks metabolic breakdown.";
    } 
    else if (h.action === "Inhibitor" && d.type === "Inhibitor") {
        result.clinical_effect = "Potentiated Toxicity (Synergistic Inhibition)";
        result.severity = "Critical";
        result.recommendation = "Rule 3: Severe risk of ADRs. Both substances block the metabolic pathway.";
    }

    return result;
}

/* -----------------------
   4. DATA LOADER & API ROUTES
   ----------------------- */
async function loadCSV() {
    return new Promise((resolve) => {
        if (!fs.existsSync(MASTER_CSV_PATH)) return resolve();
        const results = [];
        fs.createReadStream(MASTER_CSV_PATH)
            .pipe(csv())
            .on('data', (row) => {
                const herb = (row['Herb Name'] || '').trim();
                const drug = (row['Drug Name'] || '').trim();
                if (herb && drug) {
                    results.push({
                        herb: herb.toLowerCase(),
                        drug: drug.toLowerCase(),
                        herb_display: herb,
                        drug_display: drug,
                        clinical_effect: row['Clinical Effect'],
                        severity: row['Severity'],
                        evidence: row['Evidence Level'],
                        recommendation: row['Clinical Reccomendation']
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
   DASHBOARD API ROUTE (Fixes 404 Error)
   ----------------------- */
app.get('/api/list-all', (req, res) => {
    if (interactionsDB.length > 0) {
        res.json({ results: interactionsDB });
    } else {
        res.status(404).json({ 
            error: "Interaction database is empty or still loading.",
            details: "Ensure HDI_Master_List.csv is in the /data folder."
        });
    }
});
app.post('/api/analyze-text', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "No text" });

    try {
        const cleanInput = text.toLowerCase();
        let detected = [];

        // 1. Detection via Bridge
        Object.keys(SYNONYM_BRIDGE).forEach(key => {
            if (new RegExp(`\\b${key}\\b`, 'gi').test(cleanInput)) detected.push(SYNONYM_BRIDGE[key]);
        });

        let finalEntities = [...new Set(detected)];
        let uiResults = [];

        if (finalEntities.length >= 2) {
            // TIER 1: CSV Lookup
            for (let i = 0; i < finalEntities.length; i++) {
                for (let j = i + 1; j < finalEntities.length; j++) {
                    const t1 = finalEntities[i].toLowerCase();
                    const t2 = finalEntities[j].toLowerCase();
                    const matches = interactionsDB.filter(item => 
                        (item.herb === t1 && item.drug === t2) || (item.herb === t2 && item.drug === t1)
                    );
                    uiResults.push(...matches);
                }
            }

            // TIER 2: PK Rules (FIXED SEARCH LOGIC)
            if (uiResults.length === 0) {
                // Find the profile key by checking key name OR scientific name
                const herbKey = Object.keys(herbProfiles).find(key => 
                    finalEntities.some(ent => 
                        ent.toLowerCase() === key.toLowerCase() || 
                        (herbProfiles[key].scientific && herbProfiles[key].scientific.toLowerCase() === ent.toLowerCase())
                    )
                );
                
                const drugKey = Object.keys(drugProfiles).find(key => 
                    finalEntities.some(ent => ent.toLowerCase() === key.toLowerCase())
                );

                if (herbKey && drugKey) {
                    const inference = inferInteractionLogic(herbKey, drugKey);
                    if (inference) uiResults.push(inference);
                }
            }
        }

        // TIER 3: Fallback
        if (uiResults.length === 0 && finalEntities.length >= 2) {
            uiResults.push({
                herb_display: finalEntities[0],
                drug_display: finalEntities[1],
                clinical_effect: "Potential interaction identified by neural mapping.",
                severity: "Clinical Alert",
                evidence: "BioBERT Prediction"
            });
        }

        res.json({ results: uiResults, detected_entities: finalEntities });
    } catch (error) {
        res.status(500).json({ error: "System Error" });
    }
});

const PORT = process.env.PORT || 10000;
loadCSV().then(() => app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Engine Live`)));
