# Pet

**Type:** object

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | integer (int64) | No |  |
| `name` | string | Yes |  |
| `category` | object | No |  |
| `photoUrls` | string[] | Yes |  |
| `tags` | object[] | No |  |
| `status` | enum: available, pending, sold | No | pet status in the store |

## Nested Fields

### `category`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | integer (int64) | No |  |
| `name` | string | No |  |

### `tags`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | integer (int64) | No |  |
| `name` | string | No |  |


## Example

```json
{
  "id": 10,
  "name": "doggie",
  "category": {
    "id": 1,
    "name": "Dogs"
  },
  "photoUrls": [
    "string"
  ],
  "tags": [
    {
      "id": 0,
      "name": "string"
    }
  ],
  "status": "available"
}
```

