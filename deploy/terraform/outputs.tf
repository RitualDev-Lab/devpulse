output "vpc_id" {
  value = aws_vpc.devpulse.id
}

output "private_subnet_ids" {
  value = [aws_subnet.private_a.id, aws_subnet.private_b.id]
}

output "kms_key_arn" {
  value = aws_kms_key.devpulse_data.arn
}

output "artifacts_bucket" {
  value = aws_s3_bucket.telemetry_artifacts.bucket
}
