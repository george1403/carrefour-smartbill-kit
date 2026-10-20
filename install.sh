#!/usr/bin/env bash
# Linux: ./install.sh
exec bash "$(cd "$(dirname "$0")" && pwd)/scripts/install-unix.sh" "$@"
