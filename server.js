const express = require('express');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const app = express();
app.use(express.json());
// Serves your frontend (index.html, app.js, etc.)
app.use(express.static(path.join(__dirname)));

// --- 1. CONFIGURATION ---
// On Render, we talk to Python internally on port 8080
const AI_BACKEND_URL = process.env.AI_URL || 'http://127.0.0.1:8080';
const CSV_PATH = path.join(__dirname, 'data', 'interactions.csv'); 
let interactionsDB = [];

/* -----------------------
   2. Load CSV into memory
   ----------------------- */
async function loadCSV() {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(CSV_PATH)) {
            console.error(`❌ CRITICAL: CSV not found at ${CSV_PATH}`);
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

                const herb = getVal(row, 'herb').toString().trim();
                const drug = getVal(row, 'drug').toString().trim();
                
                if (herb || drug) {
                    results.push({
                        herb: herb.toLowerCase(),
                        drug: drug.toLowerCase(),
                        herb_raw: herb,
                        drug_raw: drug,
                        interaction_text: getVal(row, 'interaction_text') || getVal(row, 'interaction') || 'Caution advised.',
                        mechanism: getVal(row, 'mechanism') || 'Automated analysis.',
                        severity: getVal(row, 'severity') || 'Moderate',
                        recommendation: getVal(row, 'recommendation') || 'Consult clinical guidelines.',
                        evidence: getVal(row, 'evidence_level') || 'NLP Extraction',
                        citation: getVal(row, 'citation_url') || '#'
                    });
                }
            })
            .on('end', () => {
                interactionsDB = results;
                console.log(`✅ Database Synced: ${interactionsDB.length} records.`);
                resolve();
            })
            .on('error', (err) => {
                console.error("❌ CSV Stream Error:", err);
                reject(err);
            });
    });
}

/* -----------------------
   3. ROUTES
   ----------------------- */

// API to list everything for debugging
app.get('/api/list-all', async (req, res) => {
    await loadCSV(); 
    res.json({ results: interactionsDB });
});

// Manual search from specific dropdowns/inputs
app.post('/api/manual-check', async (req, res) => {
    const { herb, drug } = req.body;
    if (!herb || !drug) return res.status(400).json({ results: [] });

    await loadCSV();
    const sHerb = herb.toLowerCase().trim();
    const sDrug = drug.toLowerCase().trim();

    const matches = interactionsDB.filter(item => 
        (item.herb.includes(sHerb) || sHerb.includes(item.herb)) &&
        (item.drug.includes(sDrug) || sDrug.includes(item.drug))
    );
    
    res.json({ results: matches });
});

// Main AI analysis route
app.post('/api/analyze-text', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "No text provided" });

    try {
        console.log(`🤖 Forwarding to BioBERT at ${AI_BACKEND_URL}/analyze: "${text}"`);
        
        const response = await fetch(`${AI_BACKEND_URL}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text })
        });

        if (!response.ok) throw new Error(`FastAPI Error: ${response.status}`);

        const data = await response.json();
        console.log("📥 AI Raw Data received:", data);

        await loadCSV();
        
        let uiResults = [];

        // 1. Check if AI already generated a success object
        if (data.status === "success" && data.results) {
            uiResults = data.results;
        } 
        // 2. Check detected entities (strings) against our local CSV
        else if (data.detected_entities && data.detected_entities.length > 0) {
            // FIX: Map the entities to lowercase strings safely
            const foundEntities = data.detected_entities.map(e => e.toLowerCase());
            
            console.log(`🔎 Searching CSV for entities: ${foundEntities}`);

            uiResults = interactionsDB.filter(item => 
                foundEntities.some(entity => 
                    item.herb.includes(entity) || 
                    item.drug.includes(entity) ||
                    entity.includes(item.herb) || 
                    entity.includes(item.drug)
                )
            );
        }

        res.json({ results: uiResults });

    } catch (error) {
        console.error("❌ AI Bridge Failure:", error.message);
        res.status(500).json({ 
            error: "BioBERT Engine unreachable or crashed.", 
            results: [] 
        });
    }
});

/* -----------------------
   4. START SERVER
   ----------------------- */
// Render uses Port 10000 by default
const PORT = process.env.PORT || 10000;

loadCSV().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 Clinical CDSS Online`);
        console.log(`📡 Using AI Backend: ${AI_BACKEND_URL}`);
        console.log(`🌐 Listening on Port: ${PORT}\n`);
    });
});
