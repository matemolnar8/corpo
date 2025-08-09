# Corpo - AI-Powered Browser Automation

A CLI tool that uses AI to help you record and automate browser workflows using Playwright and the Model Context Protocol (MCP).

## Features

- 🎯 **Workflow Recording**: Record browser automation workflows using natural language descriptions
- 🤖 **AI-Powered Execution**: AI interprets and executes recorded workflows using Playwright
- 📝 **Interactive Recording**: Step-by-step workflow creation with validation and refinement
- 🔄 **Workflow Replay**: Run saved workflows with AI-guided execution
- 🎨 **Beautiful CLI**: Colored output and interactive prompts for better UX
- 📦 **TypeScript**: Full TypeScript support with modern ES modules

## Prerequisites

- Node.js 18+
- Google AI API key (for AI-powered workflow execution)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd corpo
```

2. Install dependencies:
```bash
npm install
```

3. Set up your Google AI API key:
```bash
export GOOGLE_GENERATIVE_AI_API_KEY="your-api-key-here"
```

4. Build the project:
```bash
npm run build
```

5. Link the CLI globally (optional):
```bash
npm link
```

## Usage

### Recording Workflows

Record a new browser automation workflow:

```bash
# Start recording a new workflow
npm run dev record
```

The recorder will:
1. Ask for a workflow name and description
2. Guide you through describing each step in natural language
3. Use AI to interpret your descriptions and execute browser actions
4. Allow you to validate and refine each step
5. Save the workflow for later use

### Running Workflows

Execute a saved workflow:

```bash
# Run a specific workflow
npm run dev run workflow-name

# Run with interactive workflow selection
npm run dev run
```

The runner will:
1. Load the saved workflow
2. Execute each step using AI-powered browser automation
3. Allow you to validate each step and provide refinements if needed

### Global Usage (if linked)

If you've linked the CLI globally, you can use it from anywhere:

```bash
corpo record
corpo run workflow-name
corpo help
```

## Development

### Available Scripts

- `npm run dev` - Run in development mode with tsx
- `npm run build` - Build the TypeScript project
- `npm run start` - Run the built version
- `npm run clean` - Clean the dist directory

### Project Structure

```
ts_rawdog/
├── src/
│   ├── index.ts           # Main CLI entry point
│   ├── recorder.ts        # Workflow recording logic
│   ├── runner.ts          # Workflow execution logic
│   ├── workflows.ts       # Workflow storage utilities
│   └── mcp/
│       ├── mcp-client.ts  # MCP client utilities
│       └── playwright-mcp.ts # Playwright MCP integration
├── workflows/             # Saved workflow files
├── package.json           # Dependencies and scripts
├── tsconfig.json          # TypeScript configuration
└── README.md              # This file
```

## Configuration

### Environment Variables

- `GOOGLE_GENERATIVE_AI_API_KEY`: Your Google AI API key (required for AI-powered execution)

### API Key Setup

1. Get your API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Set the environment variable:
   ```bash
   export GOOGLE_GENERATIVE_AI_API_KEY="your-api-key-here"
   ```
3. For persistence, add to your shell profile:
   ```bash
   echo 'export GOOGLE_GENERATIVE_AI_API_KEY="your-api-key-here"' >> ~/.bashrc
   # or for zsh
   echo 'export GOOGLE_GENERATIVE_AI_API_KEY="your-api-key-here"' >> ~/.zshrc
   ```

## Examples

### Recording a Simple Workflow

```bash
$ npm run dev record
Workflow name: telex
Description (optional): Navigate to telex.hu and click the main article

Recording started. Describe each step in natural language (e.g., 'open https://intranet and sign in', 'click the Bookings tab', 'copy the booking dates'). The agent will pick a tool and arguments. Type 'done' to finish.

Next action: Add natural-language step
Describe the next action: open telex

[AI executes browser automation...]

Validate this step: Looks good, save step
Optional note for this step: Opens the homepage

Next action: Add natural-language step  
Describe the next action: Click the leading article heading

[AI executes browser automation...]

Validate this step: Looks good, save step
Optional note for this step: Clicks the main article

Next action: Finish and save
Saved workflow to workflows/telex.json
```

### Running a Saved Workflow

```bash
$ npm run dev run telex
Running workflow 'telex' with 2 steps

Step 1/2
Instruction: open telex
Note: Opens the homepage
Reproduce: Open telex.hu homepage.

[AI executes browser automation...]

Is this step finished? Continue to next step

Step 2/2
Instruction: Click the leading article heading
Note: Clicks the main article
Reproduce: Click the leading article heading

[AI executes browser automation...]

Is this step finished? Continue to next step

Workflow completed.
```

## How It Works

1. **Recording Phase**: You describe browser actions in natural language, and the AI uses Playwright MCP to execute them
2. **Storage**: Workflows are saved as JSON files with step-by-step instructions and reproduction commands
3. **Execution Phase**: The AI reads saved workflows and re-executes the browser automation using the same tools

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

ISC License - see package.json for details. 