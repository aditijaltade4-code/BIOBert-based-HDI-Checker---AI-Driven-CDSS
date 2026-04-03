/* ---------------------------------------------
    Manual Interaction Checker
----------------------------------------------*/
window.manualInteractionCheck = async function() {
    console.log("🔍 Manual Check Triggered");

    const herbInput = document.getElementById('herbInput');
    const drugInput = document.getElementById('drugInput');
    const container = document.getElementById('manualCheckResults');

    if (!container) return;
    
    const herbSearch = herbInput.value.trim();
    const drugSearch = drugInput.value.trim();

    if (!herbSearch || !drugSearch) {
        container.innerHTML = "<div class='alert alert-warning'>⚠️ Please enter both an Herb and a Drug name.</div>";
        return;
    }

    container.innerHTML = `<div class="text-center p-3"><div class="spinner-border spinner-border-sm text-primary"></div> Checking database...</div>`; 

    try {
        // FIXED: Using relative path for Render compatibility
        const response = await fetch('/api/manual-check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ herb: herbSearch, drug: drugSearch })
        });

        if (!response.ok) throw new Error("Server response error");

        const data = await response.json();
        
        container.innerHTML = ""; 
        if (data.results && data.results.length > 0) {
            renderResults(data.results, container);
        } else {
            container.innerHTML = `
                <div style="padding: 15px; background: #eafaf1; color: #155724; border: 1px solid #c3e6cb; border-radius: 6px;">
                    ✓ No clinical interactions found for <b>${herbSearch}</b> and <b>${drugSearch}</b> in our current library.
                </div>`;
        }
    } catch (error) {
        console.error("❌ API Error:", error);
        container.innerHTML = `<div class="alert alert-danger">❌ Connection Error: Ensure the service is live on Render.</div>`;
    }
};

/* ---------------------------------------------
    Deep AI Scan (BioBERT Integration)
----------------------------------------------*/
window.runDeepAI = async function() {
    console.log("🤖 AI Scan Triggered");
    
    const textInput = document.getElementById('clinicalNoteInput');
    const resultDiv = document.getElementById('aiScanResults');
    
    if (!textInput || !textInput.value.trim()) {
        alert("Please paste clinical text or prescription notes first.");
        return;
    }

    const noteText = textInput.value;
    resultDiv.innerHTML = `
        <div class="p-4 text-center">
            <div class="spinner-border text-primary" role="status"></div>
            <p class="mt-2">⌛ BioBERT is analyzing clinical context...</p>
            <p style="font-size: 0.7rem; color: #666;">(First run may take 20s to wake up AI)</p>
        </div>`;

    try {
        // FIXED: Using relative path
        const response = await fetch('/api/analyze-text', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: noteText })
        });

        if (!response.ok) throw new Error(`Server Error: ${response.status}`);

        const data = await response.json();
        
        // HANDLE LOADING STATE: If Python returns a 'loading' status from Hugging Face
        if (data.status === "loading") {
            resultDiv.innerHTML = `
                <div class="alert alert-info text-center">
                    <div class="spinner-grow spinner-grow-sm text-info"></div>
                    <p class="mb-0"><b>AI is warming up.</b><br>Hugging Face is activating BioBERT. Please wait 15 seconds and click Analyze again.</p>
                </div>`;
            return;
        }

        resultDiv.innerHTML = ""; 
        
        if (data.results && data.results.length > 0) {
            renderResults(data.results, resultDiv);
        } else {
            const msg = data.message || "BioBERT analyzed the text but found no recognizable herb-drug pairs.";
            resultDiv.innerHTML = `<div class='alert alert-info'>${msg}</div>`;
        }

    } catch (error) {
        console.warn("⚠️ AI Backend unreachable. Using local fallback...");
        runLocalFallbackScan(noteText, resultDiv);
    }
};

/* ---------------------------------------------
    Helper: Local Fallback
----------------------------------------------*/
async function runLocalFallbackScan(text, container) {
    try {
        // FIXED: Relative path
        const response = await fetch('/api/list-all');
        const data = await response.json();
        const db = data.results || [];

        const lowerText = text.toLowerCase();
        const found = db.filter(row => {
            const h = (row.herb || "").toLowerCase();
            const d = (row.drug || "").toLowerCase();
            return h && d && lowerText.includes(h) && lowerText.includes(d);
        });

        container.innerHTML = `<div class='alert alert-warning' style='font-size:0.85rem;'>⚠️ AI Engine Offline. Searching local library keywords...</div>`;
        renderResults(found, container);
    } catch (e) {
        container.innerHTML = "<div class='alert alert-danger'>System Connectivity Error.</div>";
    }
}

/* ---------------------------------------------
    Helper: Universal UI Renderer
----------------------------------------------*/
function renderResults(matches, container) {
    if (!container.innerHTML.includes('alert-warning')) {
        container.innerHTML = ""; 
    }

    if (!matches || matches.length === 0) {
        container.innerHTML = "<p class='p-3 text-muted text-center'>No interaction flags identified.</p>";
        return;
    }

    matches.forEach(item => {
        // Normalize display data
        const displayHerb = (item.herb_raw || item.herb || "Unknown Herb").toUpperCase();
        const displayDrug = (item.drug_raw || item.drug || "Unknown Drug").toUpperCase();
        const displayNote = item.interaction_text || item.mechanism || "Refer to clinical guidelines.";
        const severity = (item.severity || "Moderate").toUpperCase();
        const recommendation = item.recommendation || "Clinical monitoring suggested.";

        const card = document.createElement('div');
        card.className = "interaction-card animate__animated animate__fadeInUp";
        card.style = `
            border-left: 6px solid ${getSevColor(severity)}; 
            padding: 20px; 
            background: #fff; 
            margin-bottom: 15px; 
            border-radius: 8px; 
            box-shadow: 0 4px 12px rgba(0,0,0,0.08);
            text-align: left;
        `;
        
        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                <h5 style="margin: 0; color: #2c3e50; font-weight: 800; font-size: 1.1rem;">${displayHerb} <span style="color:#7f8c8d; font-weight: 400;">+</span> ${displayDrug}</h5>
                <span style="background: ${getSevColor(severity)}; color: white; padding: 4px 10px; border-radius: 4px; font-size: 0.65rem; font-weight: 900;">${severity}</span>
            </div>
            <div style="font-size: 0.88rem; line-height: 1.5; color: #444;">
                <p style="margin-bottom: 8px;"><strong>Mechanism:</strong> ${displayNote}</p>
                <div style="background: #fff5f5; padding: 8px; border-radius: 4px; border-left: 3px solid #ff7675;">
                    <p style="margin-bottom: 0; color: #c0392b;"><strong>Recommendation:</strong> ${recommendation}</p>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

function getSevColor(sev) {
    const s = String(sev).toUpperCase();
    if (s.includes("HIGH") || s.includes("SEVERE") || s.includes("MAJOR")) return "#d63031"; 
    if (s.includes("MODERATE") || s.includes("WARN")) return "#fdcb6e"; 
    return "#00b894"; 
}