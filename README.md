# ACWAverse

A web-based simulation tool for analyzing cyber-physical water distribution networks.

## GitHub Pages Setup

This repository is configured to automatically deploy to GitHub Pages. Follow these steps to enable it:

### 1. Enable GitHub Pages in Repository Settings

1. Go to your repository on GitHub
2. Navigate to **Settings** → **Pages**
3. Under **Source**, select **GitHub Actions** (not "Deploy from a branch")
4. The site will automatically deploy when you push to the `main` branch

### 2. Automatic Deployment

The repository includes a GitHub Actions workflow (`.github/workflows/deploy-pages.yml`) that:
- Builds the TypeScript code
- Copies all necessary files from `src/` to `docs/`
- Deploys to GitHub Pages

The workflow runs automatically on:
- Every push to the `main` branch
- Manual trigger via the "Actions" tab → "Deploy to GitHub Pages" → "Run workflow"

### 3. Access Your Site

Once deployed, your site will be available at:
- `https://[your-username].github.io/ACWAverse/` (if this is a user/organization page)
- `https://[your-username].github.io/ACWAverse/` (if this is a project page)

Note: It may take a few minutes for the site to be available after the first deployment.

### 4. Local Development

For local development, you can use:

```bash
# Serve the application locally
python -m http.server 8000 --directory src

# Or use any static file server
cd src && python -m http.server 8000
```

To test the deployment locally:

```bash
# Build and prepare docs folder (for testing)
npm run deploy:local

# Then serve from docs
python -m http.server 8000 --directory docs
```

## Development

### Building

```bash
npm install
npm run build
```

### Testing

```bash
npm test
```

### File Structure

- `src/` - Source files (HTML, CSS, JavaScript)
- `src/data/` - Network data files
- `src/dist/` - Compiled TypeScript output
- `docs/` - Generated files for GitHub Pages (auto-created by workflow)
- `paper/` - Research paper and figures

## License

[Add your license information here]

