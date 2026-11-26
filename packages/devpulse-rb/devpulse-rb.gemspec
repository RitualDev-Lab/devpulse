Gem::Specification.new do |spec|
  spec.name          = "devpulse-rb"
  spec.version       = "1.0.0"
  spec.authors       = ["RitualDev Lab"]
  spec.email         = ["team@ritualdev.in"]
  spec.summary       = "Zero-dependency Ruby telemetry SDK for Rails, Sinatra, Sidekiq, and Rack"
  spec.license       = "MIT"
  spec.files         = Dir["lib/**/*.rb", "README.md"]
  spec.require_paths = ["lib"]
  spec.required_ruby_version = ">= 3.0"
end
