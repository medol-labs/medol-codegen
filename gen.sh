#!/bin/bash
set -e

if [ $# -eq 0 ]; then
    exec /usr/local/bin/gen-original /opt/codegen/.generator/app/
else
    exec /usr/local/bin/gen-original "$@"
fi