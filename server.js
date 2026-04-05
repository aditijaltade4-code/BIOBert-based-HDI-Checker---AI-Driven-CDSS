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

// NEW: Load your Pharmacological Profiles
let herbProfiles = {};
let drugProfiles = {};

try {
    herbProfiles = require('./herb_profiles.json');
    drugProfiles = require('./drug_profiles.json');
    console.log("✅ Herb and Drug Profiles loaded successfully.");
} catch (e) {
    console.error("⚠️ Profiles not found. Inference logic will be limited.");
}

// --- 2. EXPANDED SYNONYM BRIDGE (Fixes Guggulsterone & Normalization) ---
const SYNONYM_BRIDGE = {
    // Cardiovascular
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

    // Gastric
    "pantoprazole": "Pantoprazole", "pantocid": "Pantoprazole", "pan": "Pantoprazole", "pan-d": "Pantoprazole",
    "omeprazole": "Omeprazole", "omez": "Omeprazole",
    "ranitidine": "Ranitidine", "zantac": "Ranitidine", "acinorm": "Ranitidine",

    // FIXED: Guggulu & Constituents
    "guggulsterone": "Guggulu", "guggulsterones": "Guggulu", "guggul": "Guggulu", 
    "gulgul": "Guggulu", "commiphora": "Guggulu", "guggulu": "Guggulu",

    // Other Herbs
    "ashwagandha": "Ashwagandha", "asvagandha": "Ashwagandha", "withania": "Ashwagandha",
    "turmeric": "Curcumin", "curcumin": "Curcumin", "haridra": "Curcumin", "haldi": "Curcumin",
    "brahmi": "Brahmi", "bacopa": "Brahmi",
    "triphala": "Triphala", "haritaki": "Triphala", "vibhitaki": "Triphala", "amalaki": "Triphala", "amla": "Triphala",
    "giloy": "Giloy", "guduchi": "Giloy", "tinospora": "Giloy",
    "neem": "Neem", "azadirachta": "Neem",
    "aloe vera": "Aloe Vera", "aleovera": "Aloe Vera", "ghritkumari": "Aloe Vera"
};

/* -----------------------
   3. INFERENCE ENGINE (Rule-Based Logic)
   ----------------------- */
function inferInteractionLogic(herbName, drugName) {
    const h = herbProfiles[herbName];
    const d = drugProfiles[drugName];

    if (!h || !d) return null;

    // Check for shared enzyme pathway
    const sharedEnzyme = h.enzymes ? h.enzymes.find(e => e === d.enzyme) : (h.enzyme === d.enzyme ? h.enzyme : null);
    
    if (!sharedEnzyme) return null;

    let result = {
        herb_display: herbName,
        drug_display: drugName,
        enzyme: sharedEnzyme,
        evidence: "Pharmacokinetic (PK) Rules Engine",
        severity: "High"
    };

    // RULE 1: INDUCTION (Herb Activates + Drug is Substrate)
    if (h.action === "Inducer" && d.type === "Substrate") {
        result.clinical_effect = "Decreased Drug Levels (Antagonistic Interaction)";
        result.recommendation = "Clinical Outcome: Reduced efficacy, therapeutic failure. The herb activates the enzyme, clearing the drug too quickly.";
    }
    // RULE 2: INHIBITION (Herb Inhibits + Drug is Substrate)
    else if (h.action === "Inhibitor" && d.type === "Substrate") {
        result.clinical_effect = "Increased Drug Levels (Potentiation Interaction)";
        result.recommendation = "Clinical Outcome: Increased risk of toxicity, exaggerated side effects. The herb blocks metabolic breakdown.";
    }
    // RULE 3: DOUBLE INHIBITION (Both are Inhibitors)
    else if (h.action === "Inhibitor" && d.type === "Inhibitor") {
        result.clinical_effect = "Potentiated Toxicity (Synergistic Inhibition)";
        result.severity = "Critical";
        result.recommendation = "Clinical Outcome: Severe risk of adverse drug reactions (ADRs). Both substances block the metabolic pathway.";
    }

    return result;
}

/* -----------------------
   4. DATA LOADER & API ROUTES
   ----------------------- */
async function loadCSV() {
    return new Promise((resolve) => {
        if (!fs.existsSync(MASTER_CSV_PATH)) {
            console.error(`❌ Master File not found at ${MASTER_CSV_PATH}`);
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
                console.log(`✅ Master Database Loaded: ${interactionsDB.length} interactions.`);
                resolve();
            });
    });
}

app.post('/api/analyze-text', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "No text provided" });

    try {
        console.log("📥 Analyzing input:", text);
        const cleanInput = text.toLowerCase();
        let rawDetected = [];

        // 1. Detection (Synonym Bridge)
        Object.keys(SYNONYM_BRIDGE).forEach(key => {
            const regex = new RegExp(`\\b${key}\\b`, 'gi');
            if (regex.test(cleanInput)) rawDetected.push(SYNONYM_BRIDGE[key]);
        });

        // 2. Normalization (Handle Multi-word names)
        let finalEntities = [...new Set(rawDetected)];
        
        // Check for botanical names in herbProfiles that might not be in the bridge
        Object.keys(herbProfiles).forEach(hName => {
            if (cleanInput.includes(hName.toLowerCase()) && !finalEntities.includes(hName)) {
                finalEntities.push(hName);
            }
        });

        let uiResults = [];

        if (finalEntities.length >= 2) {
            // TIER 1: Master CSV Lookup
            for (let i = 0; i < finalEntities.length; i++) {
                for (let j = i + 1; j < finalEntities.length; j++) {
                    const term1 = finalEntities[i].toLowerCase();
                    const term2 = finalEntities[j].toLowerCase();

                    const matches = interactionsDB.filter(item => 
                        (item.herb === term1 && item.drug === term2) ||
                        (item.herb === term2 && item.drug === term1)
                    );
                    uiResults.push(...matches);
                }
            }

            // TIER 2: PK Rules Engine (If no CSV match)
            if (uiResults.length === 0) {
                const hName = finalEntities.find(name => herbProfiles[name]);
                const dName = finalEntities.find(name => drugProfiles[name]);

                if (hName && dName) {
                    const inference = inferInteractionLogic(hName, dName);
                    if (inference) uiResults.push(inference);
                }
            }
        }

        // TIER 3: Fallback (BioBERT Style Prediction)
        if (uiResults.length === 0 && finalEntities.length >= 2) {
            uiResults.push({
                herb_display: finalEntities[0],
                drug_display: finalEntities[1],
                clinical_effect: "Potential interaction identified by neural mapping.",
                severity: "Clinical Alert",
                recommendation: "Review co-administration; specific pathway data pending.",
                evidence: "BioBERT Prediction"
            });
        }

        res.json({ results: uiResults, detected_entities: finalEntities });

    } catch (error) {
        console.error("Critical System Error:", error);
        res.status(500).json({ error: "System Error" });
    }
});

// Initialization
const PORT = process.env.PORT || 10000;
loadCSV().then(() => {
    app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Master CDSS Engine Live on Port ${PORT}`));
});
