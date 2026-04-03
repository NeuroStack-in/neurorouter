package main

// Ported from: lambda/python/router-service/model_catalog.py

var models = []map[string]interface{}{
	{"id": "llama-3.3-70b-versatile", "object": "model", "created": 1700000000, "owned_by": "groq"},
	{"id": "llama-3.1-8b-instant", "object": "model", "created": 1700000000, "owned_by": "groq"},
	{"id": "llama-3.1-70b-versatile", "object": "model", "created": 1700000000, "owned_by": "groq"},
	{"id": "mixtral-8x7b-32768", "object": "model", "created": 1700000000, "owned_by": "groq"},
	{"id": "gemma2-9b-it", "object": "model", "created": 1700000000, "owned_by": "groq"},
}

func toOpenAIFormat() map[string]interface{} {
	return map[string]interface{}{
		"object": "list",
		"data":   models,
	}
}
