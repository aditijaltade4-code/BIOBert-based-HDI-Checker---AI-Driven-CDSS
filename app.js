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

    container.innerHTML = `<div class="text-center p-3"><div class="spinner-border spinner-border-sm text-primary"></div> Searching Research Database...</div>`; 

    try {
        // FIX: Combine both names into a single string so the Backend can Normalize them
        // Your Python @app.post("/analyze") expects { "text": "..." }
        const queryText = `${herbSearch} and ${drugSearch}`;
        
        const response = await fetch('/analyze', { // Change this to match your Python @app.post("/analyze")
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: queryText })
        });

        if (!response.ok) throw new Error("Server response error");

        const data = await response.json();
        
        container.innerHTML = ""; 
        if (data.results && data.results.length > 0) {
            renderResults(data.results, container);
        } else {
            container.innerHTML = `
                <div style="padding: 15px; background: #eafaf1; color: #155724; border: 1px solid #c3e6cb; border-radius: 6px;">
                    ✓ No clinical interactions found for <b>${herbSearch}</b> and <b>${drugSearch}</b>.
                </div>`;
        }
    } catch (error) {
        console.error("❌ API Error:", error);
        container.innerHTML = `<div class="alert alert-danger">❌ Connection Error: Ensure the Python backend is live.</div>`;
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
        </div>`;

    try {
        // FIX: Route matches Python @app.post("/analyze")
        const response = await fetch('/analyze', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: noteText })
        });

        if (!response.ok) throw new Error(`Server Error: ${response.status}`);

        const data = await response.json();
        
        resultDiv.innerHTML = ""; 
        
        if (data.results && data.results.length > 0) {
            renderResults(data.results, resultDiv);
        } else {
            const msg = data.message || "No recognizable herb-drug pairs found.";
            resultDiv.innerHTML = `<div class='alert alert-info'>${msg}</div>`;
        }

    } catch (error) {
        console.warn("⚠️ AI Backend unreachable.");
        resultDiv.innerHTML = `<div class='alert alert-danger'>❌ System Offline. Check Render Logs.</div>`;
    }
};

/* ---------------------------------------------
    Helper: Universal UI Renderer
----------------------------------------------*/
function renderResults(matches, container) {
    // Clear spinner/loading text
    container.innerHTML = ""; 

    matches.forEach(item => {
        // Normalize display data from your CSV columns
        const displayHerb = (item.herb || "Unknown Herb").toUpperCase();
        const displayDrug = (item.drug || "Unknown Drug").toUpperCase();
        const displayNote = item.interaction_text || "Interaction detected via clinical data.";
        const displayMech = item.mechanism || "Metabolic pathway interference.";
        const severity = (item.severity || "Moderate").toUpperCase();
        const recommendation = item.recommendation || "Consult prescribing physician.";

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
                <p style="margin-bottom: 4px;"><strong>Effect:</strong> ${displayNote}</p>
                <p style="margin-bottom: 8px; font-style: italic; color: #666;"><strong>Mechanism:</strong> ${displayMech}</p>
                <div style="background: #fff5f5; padding: 10px; border-radius: 4px; border-left: 3px solid #ff7675;">
                    <p style="margin-bottom: 0; color: #c0392b;"><strong>Recommendation:</strong> ${recommendation}</p>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

function getSevColor(sev) {
    const s = String(sev).toUpperCase();
    if (s.includes("HIGH") || s.includes("SEVERE") || s.includes("MAJOR") || s.includes("3")) return "#d63031"; 
    if (s.includes("MODERATE") || s.includes("WARN") || s.includes("2")) return "#fdcb6e"; 
    return "#00b894"; 
}
