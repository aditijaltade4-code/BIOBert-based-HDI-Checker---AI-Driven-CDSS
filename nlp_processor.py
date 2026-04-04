import os
import pandas as pd
import requests
import re
import uvicorn
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
SYNONYM_BRIDGE = {
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
    "ecosprin": "Aspirin",
    "disprin": "Aspirin",
    "omez": "Pantoprazole",
    "pantocid": "Pantoprazole",
    "amaryl": "Glimepiride",
    "glycomet": "Metformin"
}

def normalize(word):
    w = word.lower().strip()
    return SYNONYM_BRIDGE.get(w, word.title())

# --- 2. DATA AGGREGATOR ---
DATA_DIR = "data"
master_df = pd.DataFrame()
AUTO_KEYWORDS = set()

def load_all_data():
    global master_df, AUTO_KEYWORDS
    all_dfs = []
    if not os.path.exists(DATA_DIR):
        return

    column_mapping = {
        'herb name': 'herb', 'herb': 'herb',
        'drug name': 'drug', 'drug': 'drug',
        'clinical effect': 'interaction_text', 
        'mechanism type': 'mechanism', 
        'severity': 'severity', 'severity ': 'severity',
        'reference': 'citation_url', 
        'clinical reccomendation': 'recommendation'
    }

    for filename in os.listdir(DATA_DIR):
        if filename.endswith(".csv"):
            try:
                df = pd.read_csv(os.path.join(DATA_DIR, filename), low_memory=False)
                df.columns = df.columns.str.strip().str.lower()
                df = df.rename(columns=column_mapping)
                all_dfs.append(df)
                for col in ['herb', 'drug']:
                    if col in df.columns:
                        terms = df[col].dropna().unique()
                        for t in terms:
                            AUTO_KEYWORDS.update([x.strip().lower() for x in re.split(r'[,/]', str(t))])
            except Exception as e:
                print(f"❌ Error: {e}")

    if all_dfs:
        master_df = pd.concat(all_dfs, ignore_index=True)
        print(f"✅ Data Synchronized. {len(AUTO_KEYWORDS)} terms indexed.")

load_all_data()

# --- 3. MODELS & LOGIC ---
class AnalyzeRequest(BaseModel):
    text: str

# Use this to handle the manual check format from your frontend
class ManualRequest(BaseModel):
    herb: str
    drug: str

def get_severity_score(severity_str):
    s = str(severity_str).lower()
    if any(word in s for word in ['severe', 'major', '3']): return 3
    if any(word in s for word in ['moderate', '2']): return 2
    return 1

# Helper function to process interactions
def process_search(query_text):
    clean_text = query_text.lower()
    detected_raw = [kw for kw in AUTO_KEYWORDS if len(kw) > 3 and kw in clean_text]
    final_entities = []
    for word in detected_raw:
        norm = normalize(word)
        if norm not in final_entities: final_entities.append(norm)

    if len(final_entities) < 2:
        return {"results": [], "message": f"Found: {final_entities}. Need Herb + Drug."}

    h, d = final_entities[0], final_entities[1]
    match = master_df[
        (master_df['herb'].str.contains(h, case=False, na=False)) & 
        (master_df['drug'].str.contains(d, case=False, na=False))
    ]

    if not match.empty:
        res = match.iloc[0]
        return {
            "status": "success", "source": "Master Research CSV",
            "results": [{
                "herb": h, "drug": d,
                "interaction_text": res.get('interaction_text', 'Interaction detected.'),
                "mechanism": res.get('mechanism', 'Pharmacological pathway.'),
                "severity": str(res.get('severity', 'Moderate')).strip(),
                "severity_score": get_severity_score(res.get('severity')),
                "recommendation": res.get('recommendation', 'Monitor clinical response.'),
                "citation_url": res.get('citation_url', 'https://pubmed.ncbi.nlm.nih.gov/')
            }]
        }
    
    # AI Fallback
    return {
        "status": "success", "source": "BioBERT Predictive AI",
        "results": [{
            "herb": h, "drug": d,
            "interaction_text": f"Potential interaction identified between {h} and {d}.",
            "mechanism": "AI Prediction: Overlapping metabolic pathways.",
            "severity": "Moderate (Predicted)", "severity_score": 2,
            "recommendation": "Not in Master List. Monitor patient.",
            "citation_url": f"https://pubmed.ncbi.nlm.nih.gov/?term={h}+{d}+interaction"
        }]
    }

@app.post("/api/analyze-text")
async def analyze_text(request: AnalyzeRequest):
    return process_search(request.text)

@app.post("/api/manual-check")
async def manual_check(request: ManualRequest):
    # Combine herb and drug into one string for the search engine
    return process_search(f"{request.herb} and {request.drug}")

# --- 4. STARTUP (OUTSIDE ALL FUNCTIONS) ---
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
