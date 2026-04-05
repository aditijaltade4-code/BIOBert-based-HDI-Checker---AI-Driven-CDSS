const express = require('express');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// --- 1. CONFIGURATION & DATA LOADING ---
const MASTER_CSV_PATH = path.join(__dirname, 'data', 'HDI_Master_List.csv'); 

let interactionsDB = [];
let herbProfiles = {};
let drugProfiles = {};

try {
    herbProfiles = require('./herb_profiles.json');
    drugProfiles = require('./drug_profiles.json');
    console.log("✅ Profiles loaded.");
} catch (e) {
    console.error("⚠️ JSON profiles missing.");
}

// --- 2. SYNONYM BRIDGE (Keep as is) ---
const SYNONYM_BRIDGE = {
    "amlodipine": "Amlodipine", "amlowas": "Amlodipine", "stamlo": "Amlodipine", "norvasc": "Amlodipine",
    "telmisartan": "Telmisartan", "telma": "Telmisartan", "telvas": "Telmisartan",
    "atorvastatin": "Atorvastatin", "atorva": "Atorvastatin", "lipvas": "Atorvastatin",
    "warfarin": "Warfarin", "coumadin": "Warfarin",
    "aspirin": "Aspirin", "ecosprin": "Aspirin", "disprin": "Aspirin",
    "pantoprazole": "Pantoprazole", "pantocid": "Pantoprazole", "pan": "Pantoprazole", 
    "omez": "Pantoprazole", "omeprazole": "Omeprazole",
    "acorus calamus": "Acorus calamus", "vacha": "Acorus calamus",
    "aesculus indica": "Aesculus indica", "allium sativum": "Allium sativum",
    "andrographis paniculata": "Andrographis paniculata", "kalmegh": "Andrographis paniculata",
    "berberis aristata": "Berberis aristata", "daruharidra": "Berberis aristata",
    "carum carvi": "Carum carvi", "krishna jeeraka": "Carum carvi",
    "centella asiatica": "Centella asiatica", "mandukaparni": "Centella asiatica",
    "commiphora wightii": "Commiphora wightii", "guggulu": "Commiphora wightii",
    "curcuma longa": "Curcuma longa", "haridra": "Curcuma longa", "turmeric": "Curcuma longa", "haldi": "Curcuma longa",
    "curcumin": "Curcumin", "curcuminoids": "Curcumin",
    "glycyrrhiza glabra": "Glycyrrhiza glabra", "yashtimadhu": "Glycyrrhiza glabra", "mulethi": "Glycyrrhiza glabra",
    "myristica fragrans": "Myristica fragrans", "jatiphala": "Myristica fragrans",
    "narthex asafetida": "Narthex asafetida", "hing": "Narthex asafetida",
    "phyllanthus amarus": "Phyllanthus amarus", "bhumyamalaki": "Phyllanthus amarus",
    "salacia reticulata": "Salacia reticulata", "saptarangi": "Salacia reticulata",
    "terminalia arjuna": "Terminalia arjuna", "arjuna": "Terminalia arjuna",
    "terminalia chebula": "Terminalia chebula", "haritaki": "Terminalia chebula",
    "brahmi": "Brahmi", "bacopa monnieri": "Brahmi",
    "triphala": "Triphala", "amla": "Triphala", "triphala churna": "Triphala",
    "gallic acid": "Gallic Acid", "ashwagandha": "Ashwagandha", "withania": "Ashwagandha"
};

// --- 3. BIOBERT (Hugging Face) ---
async function queryBioBERT(text) {
    try {
        const response = await fetch(
            "https://api-inference.huggingface.co/models/dmis-lab/biobert-v1.1",
            {
                headers: { 
                    Authorization: `Bearer ${process.env.HF_TOKEN}`,
                    "Content-Type": "application/json"
                },
                method: "POST",
                body: JSON.stringify({ inputs: text }),
            }
        );
        return await response.json();
    } catch (e) { return null; }
}

// --- 4. PUBMED LIVE ---
async function fetchPubMedEvidence(h, d) {
    const query = `${h} AND ${d} AND "interaction"`;
    const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmode=json`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        const count = data.esearchresult.count;
        return count > 0 ? `Found ${count} related research papers on PubMed.` : "No direct evidence found on PubMed.";
    } catch (e) { return "PubMed check unavailable."; }
}

// --- 5. PK ENGINE ---
function inferInteractionLogic(hK, dK) {
    const h = herbProfiles[hK];
    const d = drugProfiles[dK];
    if (!h || !d) return null;

    const sharedEnzyme = (h.enzymes || []).find(e => e === d.enzyme) || (h.enzyme === d.enzyme ? h.enzyme : null);
    if (!sharedEnzyme) return null;

    let res = { 
        source: "PK Rules Engine", 
        herb_display: hK, 
        drug_display: dK, 
        enzyme: sharedEnzyme, 
        severity: "High" 
    };

    if (h.action === "Inducer" && d.type === "Substrate") {
        res.clinical_effect = "Decreased Drug Levels (Antagonistic)";
    } else if (h.action === "Inhibitor" && d.type === "Substrate") {
        res.clinical_effect = "Increased Drug Levels (Potentiation)";
    } else if (h.action === "Inhibitor" && d.type === "Inhibitor") {
        res.clinical_effect = "Synergistic Inhibition";
        res.severity = "Critical";
    }
    return res;
}

// --- 6. CSV LOADER ---
async function loadCSV() {
    return new Promise((resolve) => {
        if (!fs.existsSync(MASTER_CSV_PATH)) return resolve();
        fs.createReadStream(MASTER_CSV_PATH)
            .pipe(csv())
            .on('data', (row) => {
                interactionsDB.push({
                    herb: (row['Herb Name'] || '').trim().toLowerCase(),
                    drug: (row['Drug Name'] || '').trim().toLowerCase(),
                    clinical_effect: row['Clinical Effect'],
                    recommendation: row['Clinical Reccomendation'],
                    source: "Master CSV Database"
                });
            })
            .on('end', resolve);
    });
}

// --- 7. THE MASTER ROUTE ---
app.post('/api/analyze-text', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "No text" });

    try {
        const input = text.toLowerCase();
        let found = [];

        Object.keys(SYNONYM_BRIDGE).forEach(key => {
            if (new RegExp(`\\b${key}\\b`, 'gi').test(input)) {
                found.push(SYNONYM_BRIDGE[key]);
            }
        });

        let finalEntities = [...new Set(found)];
        let results = [];

        if (finalEntities.length >= 2) {
            const h = finalEntities[0];
            const d = finalEntities[1];

            // 1. PubMed
            const pubmed = await fetchPubMedEvidence(h, d);
            results.push({ source: "PubMed Live", clinical_effect: pubmed });

            // 2. BioBERT
            const ai = await queryBioBERT(text);
            if (ai) results.push({ source: "BioBERT AI", status: "Neural Mapping Active", raw: ai });

            // 3. PK Engine
            const pk = inferInteractionLogic(h, d);
            if (pk) results.push(pk);

            // 4. CSV
            const csvMatches = interactionsDB.filter(item => 
                (item.herb === h.toLowerCase() && item.drug.includes(d.toLowerCase())) ||
                (item.herb === d.toLowerCase() && item.drug.includes(h.toLowerCase()))
            );
            results.push(...csvMatches);
        }

        res.json({ results, detected_entities: finalEntities });
    } catch (e) { res.status(500).json({ error: "Fail" }); }
});
// --- 8. DASHBOARD STATS ROUTE ---
app.get('/api/dashboard-stats', (req, res) => {
    try {
        const stats = {
            totalInteractions: interactionsDB.length,
            herbsCovered: Object.keys(herbProfiles).length,
            drugsCovered: Object.keys(drugProfiles).length,
            evidenceLevel: "High (Hybrid AI + PubMed)"
        };
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: "Could not load stats" });
    }
});
const PORT = process.env.PORT || 10000;
loadCSV().then(() => app.listen(PORT, '0.0.0.0', () => console.log("🚀 Hybrid Engine Live")));
