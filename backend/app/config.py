"""Runtime settings, read from environment variables (see .env.example)."""
import os
from pathlib import Path

from dotenv import load_dotenv

# Load backend/.env first, then a .env at the repo root, without overriding real env vars.
_here = Path(__file__).resolve().parent.parent
load_dotenv(_here / ".env")
load_dotenv(_here.parent / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")

TICK_SECONDS = float(os.getenv("TICK_SECONDS", "2"))          # live telemetry interval
PERSIST_EVERY_TICKS = int(os.getenv("PERSIST_EVERY_TICKS", "5"))  # write to Supabase every N ticks
WINDOW = int(os.getenv("ROLLING_WINDOW", "30"))               # samples in the rolling window
HORIZON_MIN = 480                                             # one 8-hour shift
REPLICATIONS = int(os.getenv("SIM_REPLICATIONS", "60"))       # Monte Carlo runs per scenario
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")

# Sign-in. Format: "username:role:password", comma separated; role is operator or supervisor.
# These defaults are demo accounts - set SAFE_TWIN_USERS before anyone else can reach the app.
USERS = os.getenv("SAFE_TWIN_USERS") or "operator:operator:operator123,supervisor:supervisor:supervisor123"
AUTH_SECRET = os.getenv("AUTH_SECRET") or os.urandom(24).hex()  # unset = everyone is signed out on restart
