#!/bin/bash

cd backend && uv run langgraph dev --debug-port 5678 --wait-for-client --no-browser --allow-blocking --no-reload --n-jobs-per-worker 10
