# Unified Front-end Assets

The project now uses a single set of HTML templates and JavaScript shared
between the FastAPI web server and the Tauri desktop shell.

## Layout

```
ui/
  index.html        # landing page used by both front-ends
  generate.html     # main generation UI
  static/
    app.js          # environment-aware logic
    music.svg       # shared icon
```

Both the FastAPI application and Tauri configuration point to this `ui`
directory for front-end resources, ensuring changes only need to be made in
one place.

## FastAPI

`webui/app.py` mounts the `ui/static` directory and serves the HTML files
from `ui/`. Additional `/options/{kind}` endpoints expose preset and style
choices for the shared JavaScript.

## Tauri

`src-tauri/tauri.conf.json` now uses `../ui` as its `distDir` and `devPath`,
allowing the desktop application to load the same assets used by FastAPI.

## Updating the UI

When modifying the user interface or JavaScript logic, edit the files under
`ui/`. Both front-ends will pick up the changes automatically, reducing the
chance of divergence between the web and desktop experiences.
