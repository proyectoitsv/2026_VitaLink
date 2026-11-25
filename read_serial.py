import serial
import time
import sys

try:
    ser = serial.Serial('COM15', 115200, timeout=1)
    ser.setDTR(False)
    ser.setRTS(True)
    time.sleep(0.1)
    ser.setDTR(True)
    ser.setRTS(False)
    time.sleep(0.1)
    ser.setDTR(False)
    
    print("Escuchando COM15 por 5 segundos...")
    start_time = time.time()
    while time.time() - start_time < 5:
        if ser.in_waiting:
            line = ser.readline()
            print(line.decode('utf-8', errors='ignore').strip())
    ser.close()
except Exception as e:
    print('Error:', e)
