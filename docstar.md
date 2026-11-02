# Docstar GitHub Synchronization Format

This document provides technical specifications for synchronizing documentation from a GitHub repository to Docstar.

## 1. Directory Structure

All documentation must reside within a root directory (typically named `docs/`). The folder structure within `docs/` defines the hierarchy and navigation of the published site.

- **Folders**: Represent categories or parents.
- **Files**: Represent individual pages or endpoints.

### Special File: `page.md`

If a folder contains a `page.md` file, the content of this file becomes the content for that specific folder (the "parent" page). Without `page.md`, the folder acts as a container for its children.

**Example Structure:**

```text
docs/
├── getting-started.md      (Individual page)
├── api/                    (Folder/Category)
│   ├── page.md            (Content for the 'api' category page)
│   ├── authentication.md   (Page under 'api')
│   └── users/             (Nested Folder)
│       └── create.md      (Page under 'api/users')
```

## 2. File Format

Files must use the `.md` extension and include a YAML frontmatter section.

### YAML Frontmatter

Required and optional fields:

| Field         | Type    | Description                                    |
| :------------ | :------ | :--------------------------------------------- |
| `type`        | string  | `page` (default) or `endpoint`.                |
| `title`       | string  | The display title of the page.                 |
| `description` | string  | A short summary of the content.                |
| `published`   | boolean | Set to `true` to publish the page immediately. |

**Example Page:**

```markdown
---
type: page
title: Getting Started
description: Welcome to our documentation.
published: true
---

# Welcome

This is the markdown content of the page.
```

## 3. API Endpoints (`type: endpoint`)

For files with `type: endpoint`, the content below the frontmatter is expected to be an **OpenAPI / Swagger snippet**.

**Example Endpoint:**

```markdown
---
type: endpoint
title: Create User
published: true
---

post: /users
summary: Create a new user
parameters:

- name: username
  in: body
  required: true
  schema:
  type: string
  responses:
  200:
  description: User created successfully
```

## 4. Synchronization Mechanism

Docstar synchronizes via a GitHub Action that sends a JSON payload to the `/import/github` endpoint.

### GitHub Action Workflow

The workflow should trigger on pushes to the documentation branch and paths.

```yaml
name: Sync Docs to DocStar

on:
  push:
    branches:
      - main
    paths:
      - "docs/**"

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Send changed files to DocStar
        env:
          DOCSTAR_API_KEY: ${{ secrets.DOCSTAR_API_KEY }}
          DOCSTAR_COLLECTION_ID: "YOUR_COLLECTION_ID"
        run: |
          # The action should extract changed files (A, M, D status) 
          # and send them as an array of objects:
          # { path: string, status: "A"|"M"|"D", content: string|null }
```

## 5. Summary of Rules for AI

- **Do** use `page.md` for folder-level content.
- **Do** include YAML frontmatter in every file.
- **Do** use `type: endpoint` for API documentation.
- **Do** maintain a clean folder hierarchy.
- **Don't** use characters other than `a-z`, `0-9`, `-`, and `_` in file/folder names (to ensure clean URLs).

## 6. OpenAPI sync (`api-docs/` folder)

OpenAPI lives in its own top-level `api-docs/` folder, separate from `docs/` (Markdown). It is synced by its own workflow.

```
repo/
├── docs/                       # Markdown pages (section 1-5)
└── api-docs/
    ├── docstar.json            # optional, only sorts the modules
    ├── payments/               # a module = a folder
    │   ├── layout.json         # optional metadata of this module
    │   ├── charges.yaml        # one or more OpenAPI files; their operations are merged
    │   └── refunds.yaml
    ├── billing/
    │   ├── layout.json         # each module folder has its own layout.json
    │   └── invoices.yaml
    └── users.yaml              # a loose file is its own one-file module
```

`api-docs/docstar.json` (root, ordering only): `{ "order": ["billing", "payments", "users.yaml"] }` lists module folder names or loose file names. Listed modules take the slots they already occupy, in that order; unlisted ones and other pages stay put.

`api-docs/payments/layout.json` (all keys optional):

```json
{ "name": "Payments API", "description": "Charge and refund", "published": true, "defaultPublished": false }
```

- `name`: module name (else the first spec's `info.title`, else the folder name). `description`: stored on the module. `published`: publish or unpublish the module on sync. `defaultPublished`: publish state for endpoints created by this sync that have no `x-docstar-published`.
- Endpoints are matched on re-sync by `operationId`, else `METHOD /path`: edits update in place, operations removed from the specs are soft-deleted, and deleting every spec file of a module soft-deletes it. The same key in two files of one module is skipped with a warning.
- Publish state: `x-docstar-published: true|false` on an operation wins, then `defaultPublished` (new endpoints only). Module: `layout.json` `published`, else `x-docstar-published` on the first spec's `info`. With no flag, existing state is left alone and new items are drafts.
- Local `#/components/...` `$ref`s are resolved.
- Workflow: `GET /p/generate-docstar-openapi-workflow/:collectionId` returns a GitHub Action that posts changed `api-docs/**` files, plus every file of each touched module folder, to `POST /import/github/openapi` (same body and `DOCSTAR_API_KEY` as `/import/github`).
