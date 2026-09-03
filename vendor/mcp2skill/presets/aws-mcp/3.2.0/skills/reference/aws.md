# AWS Commands

## call — Execute AWS CLI commands

```bash
# List S3 buckets
mcp2cli aws call --cli-command 'aws s3api list-buckets --region us-east-1'

# Describe EC2 instances
mcp2cli aws call --cli-command 'aws ec2 describe-instances --region us-east-1'

# Batch: get website config for multiple buckets
mcp2cli aws call --cli-command '["aws s3api get-bucket-website --bucket bucket1", "aws s3api get-bucket-website --bucket bucket2"]'
```

Also supports: `--max-results`

Notes:
- Commands MUST start with `aws` and follow AWS CLI syntax
- Default region is us-east-1; use `--region` to override
- Use `--region *` to run across all enabled regions (no manual loops needed)
- Batch mode accepts a JSON array of up to 20 commands
- No shell pipes (`|`), redirections (`>`), or bash tools (grep, awk, sed)
- Files must be in working dir `/tmp/aws-api-mcp/workdir`

## suggest — Suggest AWS CLI commands from natural language

```bash
# Get command suggestions
mcp2cli aws suggest --query 'List all running EC2 instances in us-east-1'

# Explore options for a complex task
mcp2cli aws suggest --query 'Create a new S3 bucket with versioning and server-side encryption'
```

Returns up to 10 suggested commands with confidence scores, required parameters, and descriptions.

Use as a **fallback** when unsure of the exact CLI command. Prefer `mcp2cli aws call` when you know the command.

Use `mcp2cli aws <command> --help` for full parameter details.
