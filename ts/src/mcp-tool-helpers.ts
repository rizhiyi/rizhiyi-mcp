import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { deriveToolAnnotations } from './tool-annotations.js';
import type { ToolDefinition } from './types.js';

type JsonSchema = {
    type?: string;
    description?: string;
    enum?: unknown[];
    default?: unknown;
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    items?: JsonSchema;
    properties?: Record<string, JsonSchema>;
    required?: string[];
    additionalProperties?: boolean;
};

type ToolHandler = (args: Record<string, unknown>, extra: any) => Promise<any> | any;

function applyCommonJsonSchemaRules(schema: z.ZodTypeAny, jsonSchema: JsonSchema): z.ZodTypeAny {
    let result = schema;

    if (jsonSchema.description) {
        result = result.describe(jsonSchema.description);
    }

    if (typeof jsonSchema.default !== 'undefined') {
        result = result.default(jsonSchema.default as never);
    }

    return result;
}

function convertJsonSchemaProperty(jsonSchema: JsonSchema): z.ZodTypeAny {
    const schemaType = jsonSchema.type ?? 'string';

    if (Array.isArray(jsonSchema.enum) && jsonSchema.enum.length > 0) {
        const enumValues = jsonSchema.enum;
        if (enumValues.every((item) => typeof item === 'string')) {
            return applyCommonJsonSchemaRules(z.enum(enumValues as [string, ...string[]]), jsonSchema);
        }

        if (enumValues.length === 1) {
            return applyCommonJsonSchemaRules(z.literal(enumValues[0] as string | number | boolean | null), jsonSchema);
        }

        return applyCommonJsonSchemaRules(
            z.union(enumValues.map((item) => z.literal(item as string | number | boolean | null)) as [z.ZodLiteral<any>, z.ZodLiteral<any>, ...z.ZodLiteral<any>[]]),
            jsonSchema
        );
    }

    switch (schemaType) {
        case 'string': {
            let stringSchema = z.string();
            if (typeof jsonSchema.minLength === 'number') {
                stringSchema = stringSchema.min(jsonSchema.minLength);
            }
            if (typeof jsonSchema.maxLength === 'number') {
                stringSchema = stringSchema.max(jsonSchema.maxLength);
            }
            return applyCommonJsonSchemaRules(stringSchema, jsonSchema);
        }
        case 'integer': {
            let numberSchema = z.number().int();
            if (typeof jsonSchema.minimum === 'number') {
                numberSchema = numberSchema.min(jsonSchema.minimum);
            }
            if (typeof jsonSchema.maximum === 'number') {
                numberSchema = numberSchema.max(jsonSchema.maximum);
            }
            return applyCommonJsonSchemaRules(numberSchema, jsonSchema);
        }
        case 'number': {
            let numberSchema = z.number();
            if (typeof jsonSchema.minimum === 'number') {
                numberSchema = numberSchema.min(jsonSchema.minimum);
            }
            if (typeof jsonSchema.maximum === 'number') {
                numberSchema = numberSchema.max(jsonSchema.maximum);
            }
            return applyCommonJsonSchemaRules(numberSchema, jsonSchema);
        }
        case 'boolean':
            return applyCommonJsonSchemaRules(z.boolean(), jsonSchema);
        case 'array': {
            const itemSchema = jsonSchema.items ? convertJsonSchemaProperty(jsonSchema.items) : z.any();
            return applyCommonJsonSchemaRules(z.array(itemSchema), jsonSchema);
        }
        case 'object': {
            const shape = jsonSchemaObjectToZodShape(jsonSchema);
            const baseObjectSchema = z.object(shape);
            const objectSchema = jsonSchema.additionalProperties ? baseObjectSchema.catchall(z.any()) : baseObjectSchema.strict();
            return applyCommonJsonSchemaRules(objectSchema, jsonSchema);
        }
        default:
            return applyCommonJsonSchemaRules(z.any(), jsonSchema);
    }
}

export function jsonSchemaObjectToZodShape(jsonSchema: JsonSchema): Record<string, z.ZodTypeAny> {
    const requiredSet = new Set(jsonSchema.required || []);
    const properties = jsonSchema.properties || {};

    return Object.fromEntries(
        Object.entries(properties).map(([name, propertySchema]) => {
            let fieldSchema = convertJsonSchemaProperty(propertySchema);
            if (!requiredSet.has(name) && typeof propertySchema.default === 'undefined') {
                fieldSchema = fieldSchema.optional();
            }
            return [name, fieldSchema];
        })
    );
}

export function registerToolDefinitions(
    server: McpServer,
    tools: ToolDefinition[],
    handlers: Record<string, ToolHandler>,
    annotationsByName: Record<string, ToolAnnotations> = {}
): void {
    for (const tool of tools) {
        const handler = handlers[tool.name];
        if (!handler) {
            throw new Error(`工具 ${tool.name} 缺少处理函数。`);
        }

        server.registerTool(
            tool.name,
            {
                description: tool.description,
                inputSchema: jsonSchemaObjectToZodShape(tool.inputSchema as JsonSchema),
                annotations: {
                    ...deriveToolAnnotations(tool.name),
                    ...(annotationsByName[tool.name] || {})
                }
            },
            async (args, extra) => handler(args as Record<string, unknown>, extra)
        );
    }
}
