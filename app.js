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

    container.innerHTML = `<div class="text-center p-3"><div class="spinner-border spinner-border-sm text-primary"></div> Consulting AI & Clinical Databases...</div>`; 

    try {
        const API_BASE = window.location.hostname === "localhost" ? "" : "https://biobert-based-hdi-checker-ai-driven-cdss.onrender.com"; 

        const response = await fetch(`${API_BASE}/api/analyze-text`, { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // Sending as structured text for the backend waterfall logic
            body: JSON.stringify({ text: `${herbSearch} and ${drugSearch}` })
        });

        if (!response.ok) throw new Error("Server response error");

        const data = await response.json();
        renderResults(data, container);

    } catch (error) {
        console.error("❌ API Error:", error);
        container.innerHTML = `<div class="alert alert-danger">❌ Connection Error: Backend system is offline.</div>`;
    }
};

/* ---------------------------------------------
    Deep AI Scan (BioBERT & PubMed Hybrid)
----------------------------------------------*/
window.runDeepAI = async function() {
    const textInput = document.getElementById('clinicalNoteInput');
    const resultDiv = document.getElementById('aiScanResults');
    const pubmedStatus = document.getElementById('pubmedStatus');
    
    if (!textInput || !textInput.value.trim()) {
        alert("Please paste clinical text first.");
        return;
    }

    resultDiv.innerHTML = `<div class="p-4 text-center"><div class="spinner-border text-primary"></div><p>⌛ Executing Neural Clinical Scan...</p></div>`;
    if (pubmedStatus) pubmedStatus.style.display = "block";

    try {
        const API_BASE = window.location.hostname === "localhost" ? "" : "https://biobert-based-hdi-checker-ai-driven-cdss.onrender.com"; 
        const response = await fetch(`${API_BASE}/api/analyze-text`, { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: textInput.value })
        });

        const data = await response.json();
        if (pubmedStatus) pubmedStatus.style.display = "none";
        
        renderResults(data, resultDiv);

    } catch (error) {
        if (pubmedStatus) pubmedStatus.style.display = "none";
        resultDiv.innerHTML = `<div class='alert alert-danger'>❌ AI Analysis Failed. Check Render logs.</div>`;
    }
};

/* ---------------------------------------------
    Helper: Professional Clinical UI Renderer
----------------------------------------------*/
function renderResults(data, container) {
    container.innerHTML = ""; 
    const matches = data.results || [];
    const entities = data.entities || [];

    // If waterfall finds nothing, show the "No Interaction" message from server
    if (matches.length === 0) {
        container.innerHTML = `
            <div style="padding: 20px; background: #eafaf1; color: #155724; border: 1px solid #c3e6cb; border-radius: 12px; text-align: center;">
                <h5 style="margin-bottom: 10px;">✅ Clinical Safety Check Passed</h5>
                <p style="margin: 0;">${data.message || "No interactions present between these agents across all clinical layers."}</p>
            </div>`;
        return;
    }

    matches.forEach(item => {
        // Use Entity names sorted by the backend (Herb vs Drug)
        const herbName = entities[0] || "Agent 1";
        const drugName = entities[1] || "Agent 2";
        
        const severity = (item.severity || "MODERATE").toUpperCase();
        
        const card = document.createElement('div');
        card.className = "interaction-card animate__animated animate__fadeInUp";
        card.style = `
            border-left: 6px solid ${getSevColor(severity, item.source)}; 
            padding: 20px; background: #fff; margin-bottom: 20px; 
            border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);
            text-align: left;
        `;
        
        let contentHtml = "";

        // Case 1: Verified Master CSV Data
        if (item.source.includes("Master")) {
            contentHtml = `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 0.85rem; margin-bottom: 15px;">
                    <div><strong>Herb:</strong> ${item.herb || herbName}</div>
                    <div><strong>Drug:</strong> ${item.drug || drugName}</div>
                    <div><strong>Scientific:</strong> ${item.scientific_name || 'N/A'}</div>
                    <div><strong>Pathway:</strong> ${item.enzyme || 'Systemic Interaction'}</div>
                </div>
                <p><strong>Clinical Effect:</strong> ${item.clinical_effect}</p>
            `;
        } 
        // Case 2: Unified PubMed + AI Logic
        else if (item.source.includes("PubMed")) {
            contentHtml = `
                <p style="font-weight: bold; color: #2980b9;">Literature Evidence Detected</p>
                <p>${item.clinical_effect}</p>
                <p style="font-size: 0.8rem; color: #7f8c8d;">Neural context analyzed via BioBERT v1.1</p>
            `;
        }
        // Case 3: Pharmacokinetic Logic
        else if (item.source.includes("Pharmacokinetic")) {
            contentHtml = `
                <p><strong>Metabolic Pathway Conflict:</strong></p>
                <p>${item.clinical_effect}</p>
                <p style="font-size: 0.8rem; color: #7f8c8d;">Source: Theoretical Enzyme Profile Mapping</p>
            `;
        }
        // Case 4: Generic AI Guess (Backup only)
        else {
            contentHtml = `<p><strong>AI Pattern Detection:</strong> ${item.clinical_effect}</p>`;
        }

        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #eee; padding-bottom: 10px; margin-bottom: 15px;">
                <h4 style="margin: 0; color: #2c3e50; font-size: 1.1rem;">${item.source}</h4>
                <span style="background: ${getSevColor(severity, item.source)}; color: white; padding: 5px 12px; border-radius: 20px; font-size: 0.7rem; font-weight: bold;">${severity}</span>
            </div>
            ${contentHtml}
            <div style="background: #fff9db; padding: 12px; border-radius: 8px; border-left: 4px solid #f1c40f; margin-top: 10px;">
                <strong style="color: #856404; font-size: 0.85rem;">Clinical Recommendation:</strong>
                <p style="margin: 5px 0 0 0; color: #856404; font-size: 0.9rem;">${item.recommendation || "Monitor patient therapy and check serum levels."}</p>
            </div>
        `;
        container.appendChild(card);
    });
}

function getSevColor(sev, source) {
    const s = String(sev).toUpperCase();
    if (source && source.includes("Master")) return "#27ae60"; // Safe Green for verified data
    if (s.includes("MAJOR") || s.includes("SEVERE") || s.includes("HIGH")) return "#e74c3c"; 
    if (s.includes("MODERATE") || s.includes("MEDIUM") || s.includes("PATTERN")) return "#f39c12"; 
    if (s.includes("EVIDENCE") || s.includes("PUBMED") || s.includes("INQUIRY")) return "#3498db";
    return "#95a5a6"; 
}
