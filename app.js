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

    container.innerHTML = `<div class="text-center p-3"><div class="spinner-border spinner-border-sm text-primary"></div> Searching Master Database...</div>`; 

    try {
        // Ensure this URL matches your Render deployment
        const API_BASE = "https://biobert-based-hdi-checker-ai-driven-cdss.onrender.com"; 

        const response = await fetch(`${API_BASE}/api/analyze-text`, { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // Note: Using analyze-text logic for manual checks ensures the Normalization/Synonym bridge is applied
            body: JSON.stringify({ text: `${herbSearch} and ${drugSearch}` })
        });

        if (!response.ok) throw new Error("Server response error");

        const data = await response.json();
        
        container.innerHTML = ""; 
        if (data.results && data.results.length > 0) {
            renderResults(data.results, container);
        } else {
            container.innerHTML = `
                <div style="padding: 15px; background: #eafaf1; color: #155724; border: 1px solid #c3e6cb; border-radius: 6px;">
                    ✓ No clinical interactions found in Master List for <b>${herbSearch}</b> + <b>${drugSearch}</b>.
                </div>`;
        }
    } catch (error) {
        console.error("❌ API Error:", error);
        container.innerHTML = `<div class="alert alert-danger">❌ Connection Error: Ensure the Node.js backend is live on Render.</div>`;
    }
};

/* ---------------------------------------------
    Deep AI Scan (BioBERT Integration)
----------------------------------------------*/
window.runDeepAI = async function() {
    const textInput = document.getElementById('clinicalNoteInput');
    const resultDiv = document.getElementById('aiScanResults');
    
    if (!textInput || !textInput.value.trim()) {
        alert("Please paste clinical text first.");
        return;
    }

    resultDiv.innerHTML = `<div class="p-4 text-center"><div class="spinner-border text-primary"></div><p>⌛ Analyzing Clinical Context...</p></div>`;

    try {
        const API_BASE = "https://biobert-based-hdi-checker-ai-driven-cdss.onrender.com"; 
        const response = await fetch(`${API_BASE}/api/analyze-text`, { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: textInput.value })
        });

        const data = await response.json();
        resultDiv.innerHTML = ""; 
        
        if (data.results && data.results.length > 0) {
            renderResults(data.results, resultDiv);
        } else {
            resultDiv.innerHTML = `<div class='alert alert-info'>${data.message || "No clinical pairs identified."}</div>`;
        }
    } catch (error) {
        resultDiv.innerHTML = `<div class='alert alert-danger'>❌ System Offline.</div>`;
    }
};

/* ---------------------------------------------
    Helper: Professional Clinical UI Renderer
----------------------------------------------*/
function renderResults(matches, container) {
    container.innerHTML = ""; 

    matches.forEach(item => {
        // Map fields from your new HDI Master List CSV structure
        const herb = item.herb_display || "Unknown Herb";
        const drug = item.drug_display || "Unknown Drug";
        const severity = (item.severity || "Moderate").toUpperCase();
        
        const card = document.createElement('div');
        card.className = "interaction-card animate__animated animate__fadeInUp";
        card.style = `
            border-left: 6px solid ${getSevColor(severity)}; 
            padding: 20px; background: #fff; margin-bottom: 20px; 
            border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);
            text-align: left; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        `;
        
        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #eee; padding-bottom: 10px; margin-bottom: 15px;">
                <h4 style="margin: 0; color: #2c3e50;">${herb} <span style="color:#bdc3c7;">↔</span> ${drug}</h4>
                <span style="background: ${getSevColor(severity)}; color: white; padding: 5px 12px; border-radius: 20px; font-size: 0.75rem; font-weight: bold;">${severity}</span>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 0.85rem; margin-bottom: 15px;">
                <div><strong>Scientific:</strong> ${item.scientific_name || 'N/A'}</div>
                <div><strong>Drug Class:</strong> ${item.drug_class || 'N/A'}</div>
                <div><strong>Active Ingredients:</strong> ${item.active_ingredients || 'N/A'}</div>
                <div><strong>Enzyme Target:</strong> ${item.enzyme || 'N/A'}</div>
            </div>

            <div style="font-size: 0.9rem; color: #34495e;">
                <p><strong>Clinical Effect:</strong> ${item.clinical_effect || "Data pending."}</p>
                <p><strong>Evidence:</strong> <span style="color: #2980b9;">${item.evidence || "Not Specified"}</span></p>
                
                <div style="background: #fff9db; padding: 12px; border-radius: 8px; border-left: 4px solid #f1c40f; margin-top: 10px;">
                    <strong style="color: #856404;">Clinical Recommendation:</strong>
                    <p style="margin: 5px 0 0 0; color: #856404;">${item.recommendation || "Consult clinical guidelines."}</p>
                </div>

                ${item.reference ? `
                <div style="margin-top: 10px; font-size: 0.75rem;">
                    <a href="${item.reference}" target="_blank" style="color: #3498db; text-decoration: none;">🔗 View Research Reference</a>
                </div>` : ''}
            </div>
        `;
        container.appendChild(card);
    });
}

function getSevColor(sev) {
    const s = String(sev).toUpperCase();
    if (s.includes("MAJOR") || s.includes("SEVERE") || s.includes("HIGH")) return "#e74c3c"; 
    if (s.includes("MODERATE") || s.includes("MEDIUM")) return "#f39c12"; 
    return "#27ae60"; 
}
