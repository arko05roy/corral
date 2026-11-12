#!/bin/sh
# stand-in for claude: "does the task" by editing auth.ts
echo "fake agent got task: $2"
echo "// $2" >> README.md
sleep 1
echo "done"
