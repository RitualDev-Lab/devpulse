{{- define "devpulse.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "devpulse.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "devpulse.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "devpulse.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
app.kubernetes.io/name: {{ include "devpulse.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end -}}

{{- define "devpulse.selectorLabels" -}}
app.kubernetes.io/name: {{ include "devpulse.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
