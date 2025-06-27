#!/bin/bash

# ==============================================================================
#  Travelite Service Starter (Bash-Only Edition)
#  - Starts, stops, and monitors frontend and conversations services.
#  - Usage:
#      bash start.sh         (to start services)
#      bash start.sh monitor (to view live logs for the current session)
#      bash start.sh stop    (to stop services and clean up logs)
# ==============================================================================

# --- Configuration ---
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# --- Script Logic ---
# Assumes the script is run from the project's root directory (e.g., 'Travelite')
PROJECT_ROOT=$(pwd)
CONVERSATIONS_DIR="$PROJECT_ROOT/conversations"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
CONVERSATIONS_PID_FILE="$PROJECT_ROOT/conversations.pid"
FRONTEND_PID_FILE="$PROJECT_ROOT/frontend.pid"
CONVERSATIONS_LOG_FILE="$PROJECT_ROOT/conversations.log"
FRONTEND_LOG_FILE="$PROJECT_ROOT/frontend.log"


# --- Stop Functionality ---
# Check if the first argument is "stop"
if [ "$1" == "stop" ]; then
    echo -e "${YELLOW}🛑 Stopping Travelite services...${NC}"
    # Stop conversations server if its PID file exists
    if [ -f "$CONVERSATIONS_PID_FILE" ]; then
        echo "   - Stopping conversations server (PID: $(cat $CONVERSATIONS_PID_FILE))..."
        kill $(cat $CONVERSATIONS_PID_FILE)
        rm $CONVERSATIONS_PID_FILE
    else
        echo "   - Conversations server not running via this script (no PID file)."
    fi

    # Stop frontend if its PID file exists
    if [ -f "$FRONTEND_PID_FILE" ]; then
        echo "   - Stopping frontend (PID: $(cat $FRONTEND_PID_FILE))..."
        kill $(cat $FRONTEND_PID_FILE)
        rm $FRONTEND_PID_FILE
    else
        echo "   - Frontend not running via this script (no PID file)."
    fi

    # Clean up temporary log files
    echo "   - Cleaning up temporary log files..."
    rm -f "$CONVERSATIONS_LOG_FILE" "$FRONTEND_LOG_FILE"

    echo -e "${GREEN}✅ Services stopped.${NC}"
    exit 0
fi

# --- Monitor Functionality ---
# Check if the first argument is "monitor"
if [ "$1" == "monitor" ]; then
    echo -e "${BLUE}👀 Monitoring application logs... (Press Ctrl+C to exit)${NC}"
    if [ ! -f "$CONVERSATIONS_LOG_FILE" ] && [ ! -f "$FRONTEND_LOG_FILE" ]; then
        echo -e "${YELLOW}Log streams not found. Start the services first with 'bash start.sh'.${NC}"
        exit 1
    fi

    # Clean up background processes on script exit (e.g., via Ctrl+C)
    trap 'echo -e "\n${YELLOW}🛑 Stopping log monitor...${NC}"; kill $(jobs -p) 2>/dev/null' EXIT

    # Tail conversations logs with a blue prefix
    if [ -f "$CONVERSATIONS_LOG_FILE" ]; then
        tail -n 50 -f "$CONVERSATIONS_LOG_FILE" | sed "s/^/${BLUE}[CONVERSATIONS]${NC} /" &
    else
        echo -e "${YELLOW}Conversations log stream not found. Is it running?${NC}"
    fi

    # Tail frontend logs with a green prefix
    if [ -f "$FRONTEND_LOG_FILE" ]; then
        tail -n 50 -f "$FRONTEND_LOG_FILE" | sed "s/^/${GREEN}[FRONTEND]${NC} /" &
    else
        echo -e "${YELLOW}Frontend log stream not found. Is it running?${NC}"
    fi

    # Wait for background processes, allowing user to view logs
    wait
    exit 0
fi


# --- Header for Starting ---
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║        Starting Travelite Services     ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo "" # Newline for spacing

# --- Pre-run Checks ---
if [ ! -d "$FRONTEND_DIR" ] || [ ! -d "$CONVERSATIONS_DIR" ]; then
    echo -e "${YELLOW}Error: Cannot find 'frontend' or 'conversations' directories."
    echo "Please run this script from the project's root directory (e.g., inside 'Travelite')."
    exit 1
fi

echo "🚀 Launching services in the background..."

# --- Service Launch ---

# Start Conversations Server (backend) as a background process
echo "   - Launching Conversations Server..."
cd "$CONVERSATIONS_DIR"
# The '&' runs the command in the background. Output is redirected to a temporary log file.
node index.js > "$CONVERSATIONS_LOG_FILE" 2>&1 &
# '$!' gets the PID of the last background process. We save it to a file.
echo $! > "$CONVERSATIONS_PID_FILE"
cd "$PROJECT_ROOT"

# Start Frontend as a background process
echo "   - Launching Frontend..."
cd "$FRONTEND_DIR"
# Use 'npm start' as specified. Output is redirected to a temporary log file.
npm start > "$FRONTEND_LOG_FILE" 2>&1 &
echo $! > "$FRONTEND_PID_FILE"
cd "$PROJECT_ROOT"

# --- Final Instructions ---
echo -e "\n${GREEN}✅ Services are launching in the background.${NC}"
echo -e "   - Conversations server (for WhatsApp/Twilio) is starting."
echo -e "   - Frontend should be available shortly at ${YELLOW}http://localhost:3000${NC}."
echo -e "\nTo view live logs for this session, run this command:"
echo -e "${YELLOW}bash start.sh monitor${NC}"
echo -e "\nTo stop all services and clean up logs, run this command:"
echo -e "${YELLOW}bash start.sh stop${NC}\n"