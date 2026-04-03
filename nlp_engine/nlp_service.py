from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd
import os
import sys
import requests # Added for API calls
import uvicorn

app = FastAPI()

# --- 1. CORS SETTINGS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 2. IMPROVED CSV LOADING ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
possible_paths = [
    os.path.join(BASE_DIR, "data", "interactions.csv"),
    os.path.join(os.path.dirname(BASE_DIR), "data", "interactions.csv"),
    os.path.join(BASE_DIR, "interactions.csv")
]

interaction_db = pd.DataFrame()
db_loaded = False

for path in possible_paths:
    if os.path.exists(path):
        try:
            interaction_db = pd.read_csv(path)
            interaction_db.columns = interaction_db.columns.str.strip().str.lower()
            for col in ['herb', 'drug']:
                if col in interaction_db.columns:
                    interaction_db[col] = interaction_db[col].astype(str).str.lower().str.strip()
            print(f"--- SUCCESS: Loaded {len(interaction_db)} interactions from {path} ---")
            db_loaded = True
            break
        except Exception as e:
            print(f"--- ERROR READING CSV AT {path}: {e} ---")

# --- 3. BIOBERT VIA HUGGING FACE API (Memory Fix) ---
# We use the API because loading the model locally exceeds Render's 512MB RAM limit.
API_URL = "https://api-inference.huggingface.co/models/alvaroalon2/biobert_chemical_ner"
HF_TOKEN = os.getenv("HF_TOKEN")
headers = {"Authorization": f"Bearer {HF_TOKEN}"}

def query_biobert_api(text):
    if not HF_TOKEN:
        print("--- WARNING: HF_TOKEN not found in Environment Variables ---")
        return []
    response = requests.post(API_URL, headers=headers, json={"inputs": text})
    return response.json()

class ClinicalNote(BaseModel):
    text: str

@app.post("/analyze")
async def analyze_note(note: ClinicalNote):
    if not db_loaded:
        return {"status": "error", "message": "Interaction database not loaded."}

    try:
        # Normalize input text
        clean_text = f" {note.text.lower()} "
        
        # --- Step A: AI Extraction via API ---
        raw_results = query_biobert_api(note.text)
        
        # Handle "Model Loading" status from Hugging Face
        if isinstance(raw_results, dict) and "estimated_time" in raw_results:
            return {"status": "loading", "message": "BioBERT is waking up, please try again in 20 seconds."}

        ai_found = set()
        if isinstance(raw_results, list):
            ai_found = {res['word'].lower().replace("##", "").strip() for res in raw_results if 'word' in res and len(res['word']) > 2}

        # --- Step B: Strict Categorization ---
        known_herbs = set(interaction_db['herb'].unique())
        known_drugs = set(interaction_db['drug'].unique())
        
        detected_herbs = {h for h in known_herbs if f" {h} " in clean_text or h in ai_found}
        detected_drugs = {d for d in known_drugs if f" {d} " in clean_text or d in ai_found}
        
        all_detected = detected_herbs.union(detected_drugs)
        entities_data = [{"entity": name.capitalize(), "type": "Detected"} for name in all_detected]

        # --- Step C: Strict Interaction Matching ---
        interactions_found = []
        
        if detected_herbs and detected_drugs:
            for herb in detected_herbs:
                for drug in detected_drugs:
                    match = interaction_db[
                        ((interaction_db['herb'] == herb) & (interaction_db['drug'] == drug)) |
                        ((interaction_db['herb'] == drug) & (interaction_db['drug'] == herb))
                    ]
                    
                    if not match.empty:
                        for _, row in match.iterrows():
                            interactions_found.append({
                                "herb": str(row['herb']).capitalize(),
                                "drug": str(row['drug']).capitalize(),
                                "severity": str(row.get('severity', 'Unknown')),
                                "interaction_text": str(row.get('interaction_text', 'Warning.')),
                                "mechanism": str(row.get('mechanism', 'N/A')),
                                "recommendation": str(row.get('recommendation', 'Consult doctor.')),
                                "evidence": str(row.get('evidence_level', 'N/A'))
                            })
        
        return {
            "status": "success",
            "detected_entities": entities_data,
            "interactions": interactions_found 
        }

    except Exception as e:
        print(f"Analysis Error: {e}")
        return {"status": "error", "message": str(e)}

# --- 4. RENDER PORT BINDING FIX ---
if __name__ == "__main__":
    # Use the PORT provided by Render or default to 8000 for local dev
    port = int(os.environ.get("PORT", 8000))
    # Must use 0.0.0.0 for Render to find the app
    uvicorn.run(app, host="0.0.0.0", port=port)