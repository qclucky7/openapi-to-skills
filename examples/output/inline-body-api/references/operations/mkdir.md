# POST /dirs

**Resource:** [files](../resources/files.md)
**Create a directory**
**Operation ID:** `mkdir`

## Request Body

**Required:** Yes

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | Yes | Directory path relative to the FS root |
| `recursive` | boolean | No | Create parent directories as needed |

**Example:**

```json
{
  "path": "string",
  "recursive": true
}
```

## Responses

| Status | Description |
|--------|-------------|
| 201 | Created |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | No | Whether the directory was created |

**Example:**

```json
{
  "success": true
}
```

