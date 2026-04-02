const express = require('express');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const axios = require('axios'); // For communicating with your Python AI

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const CSV_PATH = path.join(__dirname, 'data', 'interactions.csv');
const PYTHON_AI_URL = "http://127.0.0.1:8000/analyze"; // Your BioBERT service
let interactionsDB = [];

/* -----------------------
   1. Load CSV into memory
   ----------------------- */
function loadCSV() {
    return new Promise((resolve, reject) => {
        const tempDB = [];
        if (!fs.existsSync(CSV_PATH)) {
            console.warn(`⚠️ CSV not found at ${CSV_PATH}.`);
            return resolve();
        }

        fs.createReadStream(CSV_PATH)
            .pipe(csv())
            .on('data', (row) => {
                // Ensure these matches your CSV column headers exactly
                const herb = (row.herb || row.Herb || '').toString().trim();
                const drug = (row.drug || row.Drug || '').toString().trim();
                
                if (!herb && !drug) return; 

                tempDB.push({
                    herb: herb.toLowerCase(),
                    drug: drug.toLowerCase(),
                    herb_raw: herb,
                    drug_raw: drug,
                    interaction_text: row.interaction_text || row.Interaction || '',
                    mechanism: row.mechanism || row.Mechanism || '',
                    severity: row.severity || row.Severity || 'Moderate',
                    recommendation: row.recommendation || row.Management || '',
                    evidence: row.evidence_level || '',
                    citation: row.citation_url || ''
                });
            })
            .on('end', () => {
                interactionsDB = tempDB;
                console.log(`✅ Loaded ${interactionsDB.length} records from CSV`);
                resolve();
            })
            .on('error', (err) => reject(err));
    });
}

/* -----------------------
   2. DASHBOARD ROUTES
   ----------------------- */
app.get('/api/list-all', (req, res) => {
    res.json({ results: interactionsDB });
});

/* -----------------------
   3. SEARCH & AI ROUTES
   ----------------------- */

// Manual Search Logic
app.post('/api/manual-check', (req, res) => {
    const { herb, drug } = req.body;
    if (!herb || !drug) return res.json({ count: 0, results: [] });

    const searchHerb = herb.toLowerCase().trim();
    const searchDrug = drug.toLowerCase().trim();

    const matches = interactionsDB.filter(item => 
        item.herb === searchHerb && item.drug === searchDrug
    );
    res.json({ count: matches.length, results: matches });
});

// BioBERT Text Analysis Logic
app.post('/api/analyze-text', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "No text provided" });

    try {
        // STEP A: Ask Python BioBERT what's in this text
        const aiResponse = await axios.post(PYTHON_AI_URL, { text: text });
        const detected = aiResponse.data.detected_entities;

        // Convert list to lowercase for easy matching
        const substances = detected.map(e => e.entity.toLowerCase());

        // STEP B: Find rows in our CSV where BOTH an herb and a drug from the AI list exist
        const matches = interactionsDB.filter(item => {
            return substances.some(s => s.includes(item.herb)) && 
                   substances.some(s => s.includes(item.drug));
        });

        res.json({ 
            success: true,
            detected_by_ai: detected,
            results: matches 
        });

    } catch (error) {
        console.error("AI Service Error:", error.message);
        res.status(500).json({ 
            error: "BioBERT Engine is offline.", 
            details: "Run 'python nlp_service.py' in your nlp_engine folder first." 
        });
    }
});

/* -----------------------
   4. Start Server
   ----------------------- */
const PORT = 3000;
loadCSV().then(() => {
    app.listen(PORT, () => {
        console.log(`------------------------------------------`);
        console.log(`🚀 Node.js Backend: http://localhost:${PORT}`);
        console.log(`🤖 BioBERT Connection: ${PYTHON_AI_URL}`);
        console.log(`------------------------------------------`);
    });
});