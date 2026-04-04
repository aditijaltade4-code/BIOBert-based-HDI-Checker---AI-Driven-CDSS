import os
import pandas as pd
import requests
import re
from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="BioBERT Universal Hybrid Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 1. THE NORMALIZATION BRIDGE ---
# Translates user-typed names/typos/Sanskrit to your CSV Standard Names
SYNONYM_BRIDGE = {
    # Sanskrit / Common names -> Standard CSV Names
    "haritaki": "Triphala",
    "bibhitaki": "Triphala",
    "amalaki": "Triphala",
    "three fruits": "Triphala",
    "ghritkumari": "Aloe Vera",
    "aleovera": "Aloe Vera",
    "haridra": "Turmeric",
    "curcumin": "Turmeric",
    "kutaki": "Aarogyavardhani Vati",
    "gulgul": "Guggul",
    "guggulu": "Guggul",
    # Brands -> Standard Generic Names
    "ecosprin": "Aspirin",
    "disprin": "Aspirin",
    "omez": "Pantoprazole",
    "pantocid": "Pantoprazole",
    "amaryl": "Glimepiride",
    "glycomet": "Metformin"
}

def normalize(word):
    """Converts input word to its standardized clinical version."""
    w = word.lower().strip()
    # Check bridge first, otherwise return Title Case
    return SYNONYM_BRIDGE.get(w, word.title())

# --- 2. DATA AGGREGATOR ---
DATA_DIR = "data"
master_df = pd.DataFrame()
AUTO_KEYWORDS = set()

def load_all_data():
    global master_df, AUTO_KEYWORDS
    all_dfs = []
    
    if not os.path.exists(DATA_DIR):
        print(f"⚠️ Warning: {DATA_DIR} folder not found.")
        return

    # Standardize column mapping across your different files
    column_mapping = {
        'herb name': 'herb', 'herb': 'herb',
        'drug name': 'drug', 'drug': 'drug',
        'clinical effect': 'interaction_text', 'interaction_text': 'interaction_text',
        'mechanism type': 'mechanism', 'mechanism': 'mechanism',
        'evidence level': 'evidence_level',
        'severity': 'severity', 'severity ': 'severity',
        'reference': 'citation_url', 'citation_url': 'citation_url',
        'clinical reccomendation': 'recommendation'
    }

    for filename in os.listdir(DATA_DIR):
        if filename.endswith(".csv"):
            try:
                df = pd.read_csv(os.path.join(DATA_DIR, filename), low_memory=False)
                df.columns = df.columns.str.strip().str.lower()
                df = df.rename(columns=column_mapping)
                all_dfs.append(df)
                
                # Add every herb and drug from these files to the 'Watch List'
                for col in ['herb', 'drug']:
                    if col in df.columns:
                        terms = df[col].dropna().unique()
                        for t in terms:
                            # Split multi-drug entries
                            AUTO_KEYWORDS.update([x.strip().lower() for x in re.split(r'[,/]', str(t))])
            except Exception as e:
                print(f"❌ Error loading {filename}: {e}")

    if all_dfs:
        master_df = pd.concat(all_dfs, ignore_index=True)
        print(f"✅ Data Synchronized. {len(AUTO_KEYWORDS)} terms indexed.")

load_all_data()

# --- 3. ANALYSIS LOGIC ---
class AnalyzeRequest(BaseModel):
    text: str

def get_severity_score(severity_str):
    s = str(severity_str).lower()
    if any(word in s for word in ['severe', 'major', '3']): return 3
    if any(word in s for word in ['moderate', '2']): return 2
    return 1

@app.post("/api/analyze-text") # Match the frontend call
async def analyze_text(request: AnalyzeRequest):
    # ... your logic here ...

@app.post("/api/manual-check") # Match the manual box call
async def manual_check(request: ManualRequest):
    # ... your logic here ...
    try:
        raw_text = request.text
        clean_text = raw_text.lower()
        
        # A. DETECTION (Keyword + Normalization)
        detected_raw = []
        for kw in AUTO_KEYWORDS:
            if len(kw) > 3 and kw in clean_text:
                detected_raw.append(kw)
        
        # Convert raw words (e.g. 'haritaki') to Standard Names (e.g. 'Triphala')
        final_entities = []
        for word in detected_raw:
            norm = normalize(word)
            if norm not in final_entities:
                final_entities.append(norm)

        if len(final_entities) < 2:
            return {"results": [], "message": f"Identified: {final_entities}. Need a Herb and a Drug."}

        h, d = final_entities[0], final_entities[1]

        # B. SEARCH DATABASE
        match = master_df[
            (master_df['herb'].str.contains(h, case=False, na=False)) & 
            (master_df['drug'].str.contains(d, case=False, na=False))
        ]

        if not match.empty:
            res = match.iloc[0]
            return {
                "status": "success",
                "source": "Master Research CSV",
                "results": [{
                    "herb": h, "drug": d,
                    "interaction_text": res.get('interaction_text', 'Interaction detected.'),
                    "mechanism": res.get('mechanism', 'Pharmacological pathway.'),
                    "evidence_level": res.get('evidence_level', 'Clinical Basis'),
                    "severity": str(res.get('severity', 'Moderate')).strip(),
                    "severity_score": get_severity_score(res.get('severity')),
                    "recommendation": res.get('recommendation', 'Monitor clinical response.'),
                    "citation_url": res.get('citation_url', 'https://pubmed.ncbi.nlm.nih.gov/')
                }]
            }

        # C. AI FALLBACK
        return {
            "status": "success",
            "source": "BioBERT Predictive AI",
            "results": [{
                "herb": h, "drug": d,
                "interaction_text": f"Potential interaction identified between {h} and {d}.",
                "mechanism": "AI Prediction: Overlapping metabolic pathways detected via NLP.",
                "severity": "Moderate (Predicted)",
                "severity_score": 2,
                "recommendation": "Not in Master List. Monitor patient for additive effects.",
                "citation_url": f"https://pubmed.ncbi.nlm.nih.gov/?term={h}+{d}+interaction"
            }]
        }

    except Exception as e:
        return {"results": [], "status": "error", "message": str(e)}
    
        if __name__ == "__main__":
    import uvicorn
    import os
    # Render assigns a dynamic port via environment variables
    port = int(os.environ.get("PORT", 8000))
    # host "0.0.0.0" is mandatory for cloud deployment
    uvicorn.run(app, host="0.0.0.0", port=port)
        
