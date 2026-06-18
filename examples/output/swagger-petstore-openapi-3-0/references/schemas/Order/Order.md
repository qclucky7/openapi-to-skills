# Order

**Type:** object

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | integer (int64) | No |  |
| `petId` | integer (int64) | No |  |
| `quantity` | integer (int32) | No |  |
| `shipDate` | string (date-time) | No |  |
| `status` | enum: placed, approved, delivered | No | Order Status |
| `complete` | boolean | No |  |


## Example

```json
{
  "id": 10,
  "petId": 198772,
  "quantity": 7,
  "shipDate": "2019-08-24T14:15:22Z",
  "status": "approved",
  "complete": true
}
```

