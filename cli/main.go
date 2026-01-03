package main

import (
	"os"

	"github.com/anthropics/thymer-synchub/cli/cmd"
)

func main() {
	if err := cmd.Execute(); err != nil {
		os.Exit(1)
	}
}
