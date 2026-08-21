from fastapi import FastAPI


app = FastAPI(
    title="LBV-Connect.ia API",
    version="0.1.0",
)


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "LBV-Connect.ia",
    }