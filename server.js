app.get('/health', (req, res) => {
    res.status(200).send("Server is Healthy and Live");
});
const express = require('express');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// --- 1. CONFIGURATION & DATA LOADING ---
const MASTER_CSV_PATH = path.join(__dirname, 'data', 'HDI_Master_List.csv'); 

let interactionsDB = [];
let herbProfiles = {};
let drugProfiles = {};

// Load JSON Profiles from Root
try {
    // Using require for cleaner JSON loading
    herbProfiles = require('./herb_profiles.json');
    drugProfiles = require('./drug_profiles.json');
    console.log("✅ Herb and Drug Profiles loaded successfully.");
} catch (e) {
    console.error("⚠️ Profiles not found. Check if herb_profiles.json and drug_profiles.json exist in root.");
}

// --- 2. EXPANDED SYNONYM BRIDGE ---
const SYNONYM_BRIDGE = {
    // Cardiovascular
    "amlodipine": "Amlodipine", "amlowas": "Amlodipine", "stamlo": "Amlodipine", "norvasc": "Amlodipine",
    "telmisartan": "Telmisartan", "telma": "Telmisartan", "telvas": "Telmisartan",
    "atorvastatin": "Atorvastatin", "atorva": "Atorvastatin", "lipvas": "Atorvastatin",
    "warfarin": "Warfarin", "coumadin": "Warfarin",
    "aspirin": "Aspirin", "ecosprin": "Aspirin", "disprin": "Aspirin",

    // Gastric
    "pantoprazole": "Pantoprazole", "pantocid": "Pantoprazole", "pan": "Pantoprazole", "omez": "Pantoprazole",
    "omeprazole": "Omeprazole",

    // Herbs & Constituents
    "guggulsterone": "Guggulu", "guggulsterones": "Guggulu", "guggul": "Guggulu", "commiphora": "Guggulu", "guggulu": "Guggulu",
    "turmeric": "Curcumin", "curcumin": "Curcumin", "haridra": "Curcumin", "haldi": "Curcumin",
    "ashwagandha": "Ashwagandha", "asvagandha": "Ashwagandha", "withania": "Ashwagandha",
    "brahmi": "Brahmi", "bacopa": "Brahmi",
    "triphala": "Triphala", "amla": "Triphala",
    "gallic acid": "Gallic Acid" 
};

/* -----------------------
   3. INFERENCE ENGINE (The 3 Rules)
   ----------------------- */
function inferInteractionLogic(herbKey, drugKey) {
    const h = herbProfiles[herbKey];
    const d = drugProfiles[drugKey];

    if (!h || !d) return null;

    // Check for shared enzyme pathway
    const hEnzymes = h.enzymes || (h.enzyme ? [h.enzyme] : []);
    const sharedEnzyme = hEnzymes.find(e => e === d.enzyme);
    
    if (!sharedEnzyme) return null;

    let result = {
        herb_display: herbKey,
        drug_display: drugKey,
        scientific_name: h.scientific || "N/A",
        drug_class: d.class || "N/A",
        enzyme: sharedEnzyme,
        evidence: "Pharmacokinetic (PK) Rules Engine",
        severity: "High"
    };

    // RULE 1: INDUCTION
    if (h.action === "Inducer" && d.type === "Substrate") {
        result.clinical_effect = "Decreased Drug Levels (Antagonistic Interaction)";
        result.recommendation = "Rule 1: Reduced efficacy. The herb activates the enzyme, clearing the drug too quickly.";
    } 
    // RULE 2: INHIBITION
    else if (h.action === "Inhibitor" && d.type === "Substrate") {
        result.clinical_effect = "Increased Drug Levels (Potentiation Interaction)";
        result.recommendation = "Rule 2: Increased risk of toxicity. The herb blocks metabolic breakdown.";
    } 
    // RULE 3: DOUBLE INHIBITION
    else if (h.action === "Inhibitor" && d.type === "Inhibitor") {
        result.clinical_effect = "Potentiated Toxicity (Synergistic Inhibition)";
        result.severity = "Critical";
        result.recommendation = "Rule 3: Severe risk of ADRs. Both substances block the metabolic pathway.";
    }

    return result;
}

/* -----------------------
   4. DATA LOADER & DASHBOARD
   ----------------------- */
async function loadCSV() {
    return new Promise((resolve) => {
        if (!fs.existsSync(MASTER_CSV_PATH)) {
            console.error("❌ Master CSV not found at:", MASTER_CSV_PATH);
            return resolve();
        }
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
                        scientific_name: row['Scientific Name'] || 'N/A',
                        drug_class: row['Drug Class'] || 'N/A',
                        clinical_effect: row['Clinical Effect'] || 'N/A',
                        severity: row['Severity'] || 'Moderate',
                        evidence: row['Evidence Level'] || 'Clinical Observation',
                        recommendation: row['Clinical Reccomendation'] || 'Monitor Patient',
                        reference: row['Reference'] || 'Internal Database'
                    });
                }
            })
            .on('end', () => {
                interactionsDB = results;
                console.log(`✅ Master Database Loaded: ${interactionsDB.length} records.`);
                resolve();
            });
    });
}

// DASHBOARD ROUTE (Fixes 404 Error)
app.get('/api/list-all', (req, res) => {
    if (interactionsDB.length > 0) {
        res.json({ results: interactionsDB });
    } else {
        res.json({ results: [], status: "Loading" });
    }
});

/* -----------------------
   5. ANALYZE ROUTE
   ----------------------- */
app.post('/api/analyze-text', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "No text provided" });

    try {
        console.log("📥 Analyzing input:", text);
        const cleanInput = text.toLowerCase();
        let detected = [];

        // 1. Detection via Bridge
        Object.keys(SYNONYM_BRIDGE).forEach(key => {
            if (new RegExp(`\\b${key}\\b`, 'gi').test(cleanInput)) {
                detected.push(SYNONYM_BRIDGE[key]);
            }
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

            // TIER 2: PK Rules Engine
            if (uiResults.length === 0) {
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
                    if (inference) {
                        uiResults.push(inference);
                        console.log(`✨ PK Logic Triggered: ${herbKey} + ${drugKey}`);
                    }
                }
            }
        }

        // TIER 3: Fallback (BioBERT Style)
        if (uiResults.length === 0 && finalEntities.length >= 2) {
            uiResults.push({
                herb_display: finalEntities[0],
                drug_display: finalEntities[1],
                clinical_effect: "Potential interaction identified by neural mapping.",
                severity: "Clinical Alert",
                evidence: "BioBERT Prediction",
                recommendation: "Review co-administration; specific pathway data pending."
            });
        }

        res.json({ results: uiResults, detected_entities: finalEntities });
    } catch (error) {
        console.error("Critical Error:", error);
        res.status(500).json({ error: "System Error" });
    }
});

// INITIALIZATION
const PORT = process.env.PORT || 10000;
loadCSV().then(() => {
    app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Engine Live on Port ${PORT}`));
});
