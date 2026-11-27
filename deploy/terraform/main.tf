terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }
}

resource "aws_vpc" "devpulse" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name        = "${var.name_prefix}-vpc"
    Environment = var.environment
    Sovereignty = "airgapped-vpc"
  }
}

resource "aws_subnet" "private_a" {
  vpc_id                  = aws_vpc.devpulse.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, 1)
  availability_zone       = var.availability_zones[0]
  map_public_ip_on_launch = false
  tags                    = { Name = "${var.name_prefix}-private-a" }
}

resource "aws_subnet" "private_b" {
  vpc_id                  = aws_vpc.devpulse.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, 2)
  availability_zone       = var.availability_zones[1]
  map_public_ip_on_launch = false
  tags                    = { Name = "${var.name_prefix}-private-b" }
}

resource "aws_kms_key" "devpulse_data" {
  description             = "Customer-managed KMS key for DevPulse RDS, S3 attachments & backups"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}

resource "aws_s3_bucket" "telemetry_artifacts" {
  bucket = "${var.name_prefix}-telemetry-artifacts"
}

resource "aws_s3_bucket_server_side_encryption_configuration" "telemetry_artifacts" {
  bucket = aws_s3_bucket.telemetry_artifacts.id
  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.devpulse_data.arn
      sse_algorithm     = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "telemetry_artifacts" {
  bucket                  = aws_s3_bucket.telemetry_artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_security_group" "private_data" {
  name        = "${var.name_prefix}-data-sg"
  description = "Restrict PostgreSQL / TimescaleDB / ClickHouse traffic to internal VPC"
  vpc_id      = aws_vpc.devpulse.id

  ingress {
    description = "PostgreSQL internal"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  ingress {
    description = "ClickHouse HTTP internal"
    from_port   = 8123
    to_port     = 8123
    protocol:   = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    description = "Zero external internet egress; internal VPC only"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [var.vpc_cidr]
  }
}
