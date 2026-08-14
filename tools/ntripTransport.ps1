$ErrorActionPreference = 'Stop'

function Write-ProtocolLine([string]$Line) {
    [Console]::Out.WriteLine($Line)
    [Console]::Out.Flush()
}

function New-GgaSentence($Position) {
    $latitude = [double]$Position.latitude
    $longitude = [double]$Position.longitude
    $satellites = [Math]::Max(0, [Math]::Min(99, [int]$Position.satellites))
    $now = [DateTime]::UtcNow.ToString('HHmmss.00')
    $latDegrees = [Math]::Floor([Math]::Abs($latitude))
    $latMinutes = ([Math]::Abs($latitude) - $latDegrees) * 60.0
    $lonDegrees = [Math]::Floor([Math]::Abs($longitude))
    $lonMinutes = ([Math]::Abs($longitude) - $lonDegrees) * 60.0
    $latText = '{0:00}{1:00.00000}' -f $latDegrees, $latMinutes
    $lonText = '{0:000}{1:00.00000}' -f $lonDegrees, $lonMinutes
    $latHemisphere = if ($latitude -ge 0) { 'N' } else { 'S' }
    $lonHemisphere = if ($longitude -ge 0) { 'E' } else { 'W' }
    $body = 'GPGGA,{0},{1},{2},{3},{4},1,{5:00},1.0,0.0,M,0.0,M,,' -f `
        $now, $latText, $latHemisphere, $lonText, $lonHemisphere, $satellites
    $checksum = 0
    foreach ($character in $body.ToCharArray()) {
        $checksum = $checksum -bxor [int][char]$character
    }
    return ('$' + $body + '*' + $checksum.ToString('X2') + "`r`n")
}

$client = $null
try {
    $configurationLine = [Console]::In.ReadLine()
    if ([string]::IsNullOrWhiteSpace($configurationLine)) {
        throw 'Missing NTRIP configuration'
    }
    $configuration = $configurationLine | ConvertFrom-Json
    $position = [pscustomobject]@{
        latitude = [double]$configuration.latitude
        longitude = [double]$configuration.longitude
        satellites = [int]$configuration.satellites
    }
    $mountpoint = ([string]$configuration.mountpoint).TrimStart('/')
    $token = [Convert]::ToBase64String(
        [Text.Encoding]::UTF8.GetBytes(('{0}:{1}' -f $configuration.username, $configuration.password))
    )
    $gga = (New-GgaSentence $position).Trim()
    $request = "GET /$mountpoint HTTP/1.0`r`n" +
        "User-Agent: NTRIP ACTUV-WebApp/1.0`r`n" +
        "Accept: */*`r`n" +
        "Authorization: Basic $token`r`n`r`n$gga`r`n"

    $client = [Net.Sockets.TcpClient]::new()
    $connectTask = $client.ConnectAsync([string]$configuration.host, [int]$configuration.port)
    if (-not $connectTask.Wait(10000)) { throw 'NTRIP connection timed out' }
    $stream = $client.GetStream()
    $requestBytes = [Text.Encoding]::ASCII.GetBytes($request)
    $stream.Write($requestBytes, 0, $requestBytes.Length)
    $stream.Flush()

    $header = [Collections.Generic.List[byte]]::new()
    $status = $null
    while ($null -eq $status) {
        $value = $stream.ReadByte()
        if ($value -lt 0) {
            if ($header.Count -gt 0) {
                $partialStatus = [Text.Encoding]::ASCII.GetString($header.ToArray()).Trim()
                if ($partialStatus -match '^(ICY|HTTP/\S+)\s+\d{3}\b') {
                    $status = $partialStatus
                    break
                }
            }
            throw 'Caster closed before sending status'
        }
        $header.Add([byte]$value)
        $count = $header.Count
        if ($count -ge 2 -and $header[$count - 2] -eq 13 -and $header[$count - 1] -eq 10) {
            $status = [Text.Encoding]::ASCII.GetString($header.ToArray()).Trim()
        }
        if ($count -gt 65536) { throw 'Caster response header is too large' }
    }
    if ($status -notmatch '^(ICY|HTTP/\S+)\s+200\b') {
        throw "NTRIP rejected request: $status"
    }
    if ($status -notmatch '^ICY\s+') {
        $tail = [Collections.Generic.List[byte]]::new()
        while ($true) {
            $value = $stream.ReadByte()
            if ($value -lt 0) { throw 'Caster closed while sending headers' }
            $tail.Add([byte]$value)
            $count = $tail.Count
            if ($count -ge 4 -and $tail[$count - 4] -eq 13 -and $tail[$count - 3] -eq 10 -and
                $tail[$count - 2] -eq 13 -and $tail[$count - 1] -eq 10) { break }
            if ($count -gt 65536) { throw 'Caster response header is too large' }
        }
    }
    Write-ProtocolLine "READY $status"

    $buffer = [byte[]]::new(65536)
    $lastGga = [DateTime]::UtcNow
    $pendingInput = [Console]::In.ReadLineAsync()
    while ($true) {
        if ($pendingInput.IsCompleted) {
            $line = $pendingInput.Result
            if ($null -eq $line) { break }
            if ($line.StartsWith('POSITION ')) {
                $updated = $line.Substring(9) | ConvertFrom-Json
                $position = [pscustomobject]@{
                    latitude = [double]$updated.latitude
                    longitude = [double]$updated.longitude
                    satellites = [int]$updated.satellites
                }
            }
            $pendingInput = [Console]::In.ReadLineAsync()
        }
        if ($stream.DataAvailable) {
            $count = $stream.Read($buffer, 0, $buffer.Length)
            if ($count -eq 0) { throw 'Caster closed the RTCM stream' }
            $data = [byte[]]::new($count)
            [Array]::Copy($buffer, $data, $count)
            Write-ProtocolLine ('DATA ' + [Convert]::ToBase64String($data))
        }
        $now = [DateTime]::UtcNow
        if (($now - $lastGga).TotalSeconds -ge 5.0) {
            $ggaBytes = [Text.Encoding]::ASCII.GetBytes((New-GgaSentence $position))
            $stream.Write($ggaBytes, 0, $ggaBytes.Length)
            $stream.Flush()
            $lastGga = $now
        }
        Start-Sleep -Milliseconds 5
    }
}
catch {
    Write-ProtocolLine ('ERROR ' + $_.Exception.Message.Replace("`r", ' ').Replace("`n", ' '))
    exit 1
}
finally {
    if ($null -ne $client) { $client.Dispose() }
}
