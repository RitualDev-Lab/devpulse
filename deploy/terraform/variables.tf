variable "name_prefix" {
  type        = string
  description = "Resource name prefix for private DevPulse VPC deployment"
  default     = "devpulse-ent"
}

variable "environment" {
  type    = string
  default = "production"
}

variable "vpc_cidr" {
  type    = string
  default = "10.42.0.0/16"
}

variable "availability_zones" {
  type    = list(string)
  default = ["us-east-1a", "us-east-1b"]
}
