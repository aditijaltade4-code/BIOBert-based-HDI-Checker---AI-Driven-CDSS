from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from transformers import pipeline
import uvicorn
import pandas as pd
import os
import sys

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

# --- 3. INITIALIZE BIOBERT ---
MODEL_NAME = "alvaroalon2/biobert_chemical_ner"
try:
    hdi_engine = pipeline("ner", model=MODEL_NAME, aggregation_strategy="simple")
    print("--- SUCCESS: BioBERT Chemical NER is online ---")
except Exception as e:
    print(f"--- FATAL ERROR STARTING AI: {e} ---")
    sys.exit(1)

class ClinicalNote(BaseModel):
    text: str

@app.post("/analyze")
async def analyze_note(note: ClinicalNote):
    if not db_loaded:
        return {"status": "error", "message": "Interaction database not loaded."}

    try:
        # Normalize input text
        clean_text = f" {note.text.lower()} "
        
        # --- Step A: AI Extraction ---
        raw_results = hdi_engine(note.text)
        ai_found = {res['word'].lower().replace("##", "").strip() for res in raw_results if len(res['word']) > 2}

        # --- Step B: Strict Categorization ---
        known_herbs = set(interaction_db['herb'].unique())
        known_drugs = set(interaction_db['drug'].unique())
        
        # Identify exactly what was found in the text
        detected_herbs = {h for h in known_herbs if f" {h} " in clean_text or h in ai_found}
        detected_drugs = {d for d in known_drugs if f" {d} " in clean_text or d in ai_found}
        
        # Prepare entities for display
        all_detected = detected_herbs.union(detected_drugs)
        entities_data = [{"entity": name.capitalize(), "type": "Detected"} for name in all_detected]

        # --- Step C: Strict Interaction Matching ---
        interactions_found = []
        
        # CRITICAL: Only look for interactions if BOTH a herb and a drug are present
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
        
        # Print debug info to console
        print(f"🔍 Found Herbs: {detected_herbs} | Found Drugs: {detected_drugs}")
        print(f"✨ Sending {len(interactions_found)} interactions to Frontend.")

        return {
            "status": "success",
            "detected_entities": entities_data,
            "interactions": interactions_found 
        }

    except Exception as e:
        print(f"Analysis Error: {e}")
        return {"status": "error", "message": str(e)}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)