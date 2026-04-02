const express = require('express');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const CSV_PATH = path.join(__dirname, 'data', 'interactions.csv'); 
let interactionsDB = [];

/* -----------------------
   1. Load CSV into memory
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
   2. ROUTES
   ----------------------- */

app.get('/api/list-all', async (req, res) => {
    await loadCSV(); 
    res.json({ results: interactionsDB });
});

app.post('/api/manual-check', async (req, res) => {
    const { herb, drug } = req.body;
    if (!herb || !drug) return res.status(400).json({ results: [] });

    await loadCSV(); // Ensure we have the latest data
    const sHerb = herb.toLowerCase().trim();
    const sDrug = drug.toLowerCase().trim();

    const matches = interactionsDB.filter(item => 
        (item.herb.includes(sHerb) || sHerb.includes(item.herb)) &&
        (item.drug.includes(sDrug) || sDrug.includes(item.drug))
    );
    
    res.json({ results: matches });
});

// AI Bridge: Fixed to handle "detected_entities" fallback
app.post('/api/analyze-text', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "No text provided" });

    try {
        console.log(`🤖 Forwarding to BioBERT: "${text}"`);
        
        const response = await fetch('http://127.0.0.1:8000/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text })
        });

        if (!response.ok) throw new Error(`FastAPI Error: ${response.status}`);

        const data = await response.json();
        console.log("📥 AI Raw Data received:", data);

        await loadCSV(); // Refresh internal DB from CSV
        
        let uiResults = [];

        // CASE 1: Python sent a specific interaction result list
        if (data.results && data.results.length > 0) {
            uiResults = data.results;
        } 
        // CASE 2: Python found entities (like 'atenolol') but no direct "interaction" object
        else if (data.detected_entities && data.detected_entities.length > 0) {
            const firstEntity = data.detected_entities[0].entity.toLowerCase();
            console.log(`🎯 Searching CSV for detected entity: ${firstEntity}`);
            
            uiResults = interactionsDB.filter(item => 
                item.herb.includes(firstEntity) || 
                item.drug.includes(firstEntity) ||
                firstEntity.includes(item.herb) || 
                firstEntity.includes(item.drug)
            );
        }

        console.log(`✨ Sending ${uiResults.length} results to Frontend.`);
        res.json({ results: uiResults });

    } catch (error) {
        console.error("❌ AI Bridge Failure:", error.message);
        res.status(500).json({ 
            error: "BioBERT Engine unreachable.", 
            results: [] 
        });
    }
});

/* -----------------------
   3. START SERVER
   ----------------------- */
const PORT = 3000;
loadCSV().then(() => {
    app.listen(PORT, () => {
        console.log(`\n🚀 Clinical CDSS Online`);
        console.log(`🔗 Frontend: http://localhost:${PORT}`);
        console.log(`📡 AI Backend: http://localhost:8000\n`);
    });
});