"""
Run script for NeuroStack OpenAI Proxy
"""
import uvicorn
import os

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 7860)),
        reload=True
    )
