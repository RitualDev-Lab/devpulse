# frozen_string_literal: true

require "json"
require "net/http"
require "uri"

module DevPulse
  DEFAULT_ENDPOINT = "https://devpulse.ritualdev.in"
  EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.freeze
  AUTH_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]+/i.freeze

  class Client
    def initialize(api_key:, endpoint: DEFAULT_ENDPOINT, release: nil, scrub_pii: true, max_breadcrumbs: 40)
      @api_key = api_key
      @endpoint = endpoint.sub(%r{/+$}, "")
      @release = release
      @scrub_pii = scrub_pii
      @max_breadcrumbs = max_breadcrumbs
      @breadcrumbs = []
      @mutex = Mutex.new
    end

    def self.redact_pii(input)
      return "" if input.nil?
      input.to_s.gsub(AUTH_RE, '\1 [REDACTED]').gsub(EMAIL_RE, "[REDACTED_EMAIL]")
    end

    def add_breadcrumb(category, level, message)
      msg = @scrub_pii ? self.class.redact_pii(message) : message
      @mutex.synchronize do
        @breadcrumbs << { timestamp: Time.now.to_i, category: category, level: level, message: msg }
        @breadcrumbs.shift while @breadcrumbs.size > @max_breadcrumbs
      end
    end

    def capture_exception(error, route_path: nil)
      msg = @scrub_pii ? self.class.redact_pii(error.message) : error.message
      trace = @scrub_pii ? self.class.redact_pii(Array(error.backtrace).join("\n")) : Array(error.backtrace).join("\n")
      crumbs = @mutex.synchronize { @breadcrumbs.dup }
      post("/api/v1/event", {
        apiKey: @api_key,
        errorName: error.class.name,
        message: msg,
        stackTrace: trace,
        runtime: "ruby",
        os: RUBY_PLATFORM,
        version: @release || "1.0.0",
        routePath: route_path,
        breadcrumbs: crumbs
      })
    end

    def track_metric(metric_name, metric_value)
      post("/api/v1/analytics", {
        project: @api_key,
        metricName: metric_name,
        metricValue: metric_value,
        sourceType: "app",
        os: RUBY_PLATFORM,
        appVersion: @release
      })
    end

    private

    def post(path, payload)
      uri = URI("#{@endpoint}#{path}")
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = uri.scheme == "https"
      http.open_timeout = 3
      http.read_timeout = 4
      req = Net::HTTP::Post.new(uri.request_uri, "Content-Type" => "application/json")
      req.body = JSON.generate(payload)
      res = http.request(req)
      res.code.to_i < 400
    rescue StandardError
      false
    end
  end

  class RackMiddleware
    def initialize(app, client)
      @app = app
      @client = client
    end

    def call(env)
      @client.add_breadcrumb("http", "info", "#{env["REQUEST_METHOD"]} #{env["PATH_INFO"]}")
      @app.call(env)
    rescue Exception => e
      @client.capture_exception(e, route_path: env["PATH_INFO"])
      raise
    end
  end
end
