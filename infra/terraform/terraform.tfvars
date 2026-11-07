project                = "jude"
environment            = "dev"
vpc_cidr               = "10.40.0.0/16"
db_engine_version      = "latest"
db_instance_class      = "db.t4g.micro"
db_multi_az            = false
db_backup_days         = 7
db_deletion_protection = true

# Temporary public access from any IPv4 address, as requested.
db_publicly_accessible  = true
db_allowed_public_cidrs = ["0.0.0.0/0"]
